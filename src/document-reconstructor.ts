import {
  ENTRY_TYPES,
  isLiveSyncChunkDocument,
  isLiveSyncFileDocument,
  type LiveSyncChunkDocument,
  type LiveSyncFileDocument
} from "./livesync-constants";
import type { CachedRemoteDocument, LocalDocumentStore } from "./local-document-store";
import { base64ToBytes, Base64DecodeError } from "./base64";
import {
  decryptChunkDocument,
  decryptFileDocument,
  DocumentTransformError,
  hasEncryptedMetadata,
  isEncryptedChunk,
  type DocumentTransformOptions
} from "./document-transform";

export type ReconstructionStatus =
  | "ready"
  | "deleted"
  | "missing-chunks"
  | "encrypted-unsupported"
  | "unsupported";

export type ReconstructedDocumentPreview = {
  id: string;
  rev: string;
  path: string;
  status: ReconstructionStatus;
  contentType: "text" | "binary";
  chunkCount: number;
  byteLength: number;
  content?: string | ArrayBuffer;
  missingChunkIds?: string[];
  reason?: string;
};

export type ReconstructionBatchSummary = {
  checked: number;
  ready: number;
  deleted: number;
  missingChunks: number;
  encryptedUnsupported: number;
  unsupported: number;
  previews: ReconstructedDocumentPreview[];
};

type EdenChunk = {
  data: string;
  epoch?: number;
};

type ChunkLoadResult =
  | {
      status: "ready";
      chunks: LiveSyncChunkDocument[];
    }
  | {
      status: "missing-chunks";
      missingChunkIds: string[];
    }
  | {
      status: "encrypted-unsupported";
      reason: string;
    }
  | {
      status: "unsupported";
      reason: string;
    };

type ReconstructionRuntimeOptions = {
  yieldToUi?(): Promise<void>;
  yieldEveryChunks?: number;
  loadMissingChunks?(ids: string[]): Promise<Map<string, LiveSyncChunkDocument>>;
};

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function contentKind(doc: LiveSyncFileDocument | undefined): "text" | "binary" {
  return doc?.type === ENTRY_TYPES.NOTE_BINARY ? "binary" : "text";
}

function documentPath(doc: LiveSyncFileDocument): string {
  return doc.path || doc._id;
}

function legacyContent(doc: LiveSyncFileDocument): string {
  if (Array.isArray(doc.data)) {
    return doc.data.join("");
  }
  return typeof doc.data === "string" ? doc.data : "";
}

function previewBase(
  cached: CachedRemoteDocument,
  status: ReconstructionStatus,
  path: string,
  doc?: LiveSyncFileDocument
): ReconstructedDocumentPreview {
  return {
    id: cached.id,
    rev: cached.rev,
    path,
    status,
    contentType: contentKind(doc),
    chunkCount: doc?.children?.length ?? 0,
    byteLength: 0
  };
}

function readyPreview(
  cached: CachedRemoteDocument,
  doc: LiveSyncFileDocument,
  content: string | ArrayBuffer,
  chunkCount: number
): ReconstructedDocumentPreview {
  return {
    ...previewBase(cached, "ready", documentPath(doc), doc),
    chunkCount,
    byteLength: typeof content === "string" ? byteLength(content) : content.byteLength,
    content
  };
}

function isEdenChunk(value: unknown): value is EdenChunk {
  return !!value && typeof value === "object" && typeof (value as { data?: unknown }).data === "string";
}

function edenChunk(doc: LiveSyncFileDocument, childId: string): LiveSyncChunkDocument | undefined {
  const value = doc.eden?.[childId];
  if (!isEdenChunk(value)) {
    return undefined;
  }
  return {
    _id: childId,
    type: ENTRY_TYPES.CHUNK,
    data: value.data
  };
}

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function binaryContentFromChunks(chunks: LiveSyncChunkDocument[]): ArrayBuffer {
  const decodedChunks = chunks.map((chunk) => base64ToBytes(chunk.data));
  const totalLength = decodedChunks.reduce((sum, bytes) => sum + bytes.byteLength, 0);
  const content = new Uint8Array(totalLength);
  let offset = 0;
  for (const bytes of decodedChunks) {
    content.set(bytes, offset);
    offset += bytes.byteLength;
  }
  return arrayBufferFromBytes(content);
}

function contentFromChunks(doc: LiveSyncFileDocument, chunks: LiveSyncChunkDocument[]): string | ArrayBuffer {
  if (doc.type === ENTRY_TYPES.NOTE_BINARY) {
    return binaryContentFromChunks(chunks);
  }
  return chunks.map((chunk) => chunk.data).join("");
}

export class DocumentReconstructor {
  private readonly store: LocalDocumentStore;
  private readonly transformOptions: DocumentTransformOptions;
  private readonly runtime?: ReconstructionRuntimeOptions;

  constructor(
    store: LocalDocumentStore,
    transformOptions: DocumentTransformOptions,
    runtime?: ReconstructionRuntimeOptions
  ) {
    this.store = store;
    this.transformOptions = transformOptions;
    this.runtime = runtime;
  }

  async previewPending(limit: number): Promise<ReconstructionBatchSummary> {
    return this.previewBatch(await this.store.getPendingApplyBatch(limit));
  }

  async previewPendingStaging(limit: number): Promise<ReconstructionBatchSummary> {
    return this.previewBatch(await this.store.getPendingStagingBatch(limit));
  }

  async preview(cached: CachedRemoteDocument): Promise<ReconstructedDocumentPreview> {
    if (!isLiveSyncFileDocument(cached.doc)) {
      return this.unsupported(cached, "Cached document is not a LiveSync file document.");
    }

    const decrypted = await this.decryptFileOrReturnStatus(cached, cached.doc);
    if ("status" in decrypted) {
      return decrypted;
    }
    if (cached.deleted || decrypted._deleted || decrypted.deleted) {
      return {
        ...previewBase(cached, "deleted", documentPath(decrypted), decrypted),
        reason: "Remote document is deleted."
      };
    }
    if (decrypted.type === ENTRY_TYPES.NOTE_LEGACY) {
      return readyPreview(cached, decrypted, legacyContent(decrypted), 0);
    }
    if (decrypted.type !== ENTRY_TYPES.NOTE_BINARY && decrypted.type !== ENTRY_TYPES.NOTE_PLAIN) {
      return this.unsupported(cached, `Unsupported LiveSync file type: ${decrypted.type}`);
    }

    return this.previewChunkedDocument(cached, decrypted);
  }

  private async previewBatch(pending: CachedRemoteDocument[]): Promise<ReconstructionBatchSummary> {
    await this.prefetchMissingChunksForBatch(pending);
    const previews = [];
    for (const cached of pending) {
      await this.runtime?.yieldToUi?.();
      previews.push(await this.preview(cached).catch((error) => this.unsupported(cached, friendlyPreviewError(error))));
      await this.runtime?.yieldToUi?.();
    }
    return this.summarise(previews);
  }

  private async prefetchMissingChunksForBatch(pending: CachedRemoteDocument[]): Promise<void> {
    if (!this.runtime?.loadMissingChunks || pending.length === 0) {
      return;
    }

    const childIds = new Set<string>();
    for (const cached of pending) {
      await this.runtime.yieldToUi?.();
      const doc = await this.chunkedFileDocumentForPrefetch(cached);
      if (!doc) {
        continue;
      }
      for (const childId of doc.children ?? []) {
        if (!edenChunk(doc, childId)) {
          childIds.add(childId);
        }
      }
    }

    const ids = [...childIds];
    if (ids.length === 0) {
      return;
    }

    const cachedChunks = await this.store.getCachedDocuments(ids);
    const missingIds = ids.filter((id) => !cachedChunks.has(id));
    if (missingIds.length === 0) {
      return;
    }

    await this.runtime.yieldToUi?.();
    await this.runtime.loadMissingChunks(missingIds);
    await this.runtime.yieldToUi?.();
  }

  private async chunkedFileDocumentForPrefetch(cached: CachedRemoteDocument): Promise<LiveSyncFileDocument | undefined> {
    if (!isLiveSyncFileDocument(cached.doc)) {
      return undefined;
    }
    const decrypted = await this.decryptFileOrReturnStatus(cached, cached.doc).catch(() => undefined);
    if (!decrypted || "status" in decrypted || cached.deleted || decrypted._deleted || decrypted.deleted) {
      return undefined;
    }
    return decrypted.type === ENTRY_TYPES.NOTE_BINARY || decrypted.type === ENTRY_TYPES.NOTE_PLAIN
      ? decrypted
      : undefined;
  }

  private async previewChunkedDocument(
    cached: CachedRemoteDocument,
    doc: LiveSyncFileDocument
  ): Promise<ReconstructedDocumentPreview> {
    const loaded = await this.loadChunks(doc);
    if (loaded.status === "ready") {
      try {
        return readyPreview(cached, doc, contentFromChunks(doc, loaded.chunks), loaded.chunks.length);
      } catch (error) {
        return this.unsupported(cached, friendlyPreviewError(error));
      }
    }
    if (loaded.status === "missing-chunks") {
      return {
        ...previewBase(cached, "missing-chunks", documentPath(doc), doc),
        missingChunkIds: loaded.missingChunkIds,
        reason: `Missing ${loaded.missingChunkIds.length} of ${doc.children?.length ?? 0} chunks.`
      };
    }
    return {
      ...previewBase(cached, loaded.status, documentPath(doc), doc),
      reason: loaded.reason
    };
  }

  private async loadChunks(doc: LiveSyncFileDocument): Promise<ChunkLoadResult> {
    const children = doc.children ?? [];
    let cachedChunks = await this.store.getCachedDocuments(children);
    const chunks: LiveSyncChunkDocument[] = [];
    const missingChunkIds: string[] = [];

    for (const childId of children) {
      const chunk = cachedChunks.get(childId)?.doc ?? edenChunk(doc, childId);
      if (!chunk) {
        missingChunkIds.push(childId);
      }
    }

    if (missingChunkIds.length > 0 && this.runtime?.loadMissingChunks) {
      const repairedChunks = await this.runtime.loadMissingChunks(missingChunkIds);
      if (repairedChunks.size > 0) {
        cachedChunks = new Map(cachedChunks);
        for (const [id, chunk] of repairedChunks) {
          cachedChunks.set(id, {
            id,
            rev: chunk._rev ?? "",
            seq: "",
            pulledAt: Date.now(),
            stagedAt: 0,
            appliedAt: 0,
            deleted: false,
            kind: "chunk",
            doc: chunk
          });
        }
      }
    }

    chunks.length = 0;
    missingChunkIds.length = 0;
    for (const [index, childId] of children.entries()) {
      const chunk = cachedChunks.get(childId)?.doc ?? edenChunk(doc, childId);
      if (!chunk) {
        missingChunkIds.push(childId);
        continue;
      }
      if (!isLiveSyncChunkDocument(chunk)) {
        return { status: "unsupported", reason: `Cached chunk is not a leaf document: ${childId}` };
      }

      const decrypted = await this.decryptChunkOrReturnStatus(chunk);
      if ("status" in decrypted) {
        return decrypted;
      }
      chunks.push(decrypted);
      const yieldEveryChunks = Math.max(1, this.runtime?.yieldEveryChunks ?? 8);
      if (this.runtime?.yieldToUi && index + 1 < children.length && (index + 1) % yieldEveryChunks === 0) {
        await this.runtime.yieldToUi();
      }
    }

    return missingChunkIds.length > 0 ? { status: "missing-chunks", missingChunkIds } : { status: "ready", chunks };
  }

  private async decryptChunkOrReturnStatus(
    chunk: LiveSyncChunkDocument
  ): Promise<LiveSyncChunkDocument | ChunkLoadResult> {
    try {
      return await decryptChunkDocument(chunk, this.transformOptions);
    } catch (error) {
      if (!(error instanceof DocumentTransformError) && !isEncryptedChunk(chunk)) {
        throw error;
      }
      return {
        status: "encrypted-unsupported",
        reason: error instanceof Error ? error.message : "Encrypted chunk reconstruction failed."
      };
    }
  }

  private async decryptFileOrReturnStatus(
    cached: CachedRemoteDocument,
    doc: LiveSyncFileDocument
  ): Promise<LiveSyncFileDocument | ReconstructedDocumentPreview> {
    try {
      return await decryptFileDocument(doc, this.transformOptions);
    } catch (error) {
      if (!(error instanceof DocumentTransformError) && !hasEncryptedMetadata(doc)) {
        throw error;
      }
      return {
        ...previewBase(cached, "encrypted-unsupported", documentPath(doc), doc),
        reason: error instanceof Error ? error.message : "Encrypted metadata reconstruction failed."
      };
    }
  }

  private unsupported(cached: CachedRemoteDocument, reason: string): ReconstructedDocumentPreview {
    return {
      ...previewBase(cached, "unsupported", cached.doc?.path ?? cached.id, cached.doc as LiveSyncFileDocument | undefined),
      reason
    };
  }

  private summarise(previews: ReconstructedDocumentPreview[]): ReconstructionBatchSummary {
    return {
      checked: previews.length,
      ready: previews.filter((preview) => preview.status === "ready").length,
      deleted: previews.filter((preview) => preview.status === "deleted").length,
      missingChunks: previews.filter((preview) => preview.status === "missing-chunks").length,
      encryptedUnsupported: previews.filter((preview) => preview.status === "encrypted-unsupported").length,
      unsupported: previews.filter((preview) => preview.status === "unsupported").length,
      previews
    };
  }
}

function friendlyPreviewError(error: unknown): string {
  if (error instanceof Base64DecodeError) {
    return "Remote binary content is not valid base64.";
  }
  return error instanceof Error ? error.message : "Remote file could not be reconstructed.";
}
