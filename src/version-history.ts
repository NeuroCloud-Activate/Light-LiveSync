import type { DataAdapter } from "obsidian";
import {
  ENTRY_TYPES,
  isLiveSyncChunkDocument,
  isLiveSyncFileDocument,
  type LiveSyncChunkDocument,
  type LiveSyncDocument,
  type LiveSyncFileDocument
} from "./livesync-constants";
import { pathToLiveSyncDocumentId } from "./livesync-document-builder";
import {
  decryptChunkDocument,
  decryptFileDocument,
  type DocumentTransformOptions
} from "./document-transform";
import {
  createRecoveryBackupForPath,
  ensureRecoveryFolder
} from "./recovery-backups";
import { isTextSyncPath } from "./vault-scan";

export type VersionHistoryRetention = {
  maxVersionsPerFile: number;
  maxVersionAgeDays: number;
};

export type VersionWriteResult = {
  saved: number;
  skipped: number;
  pruned: number;
};

export type FileVersionEntry = {
  id: string;
  fileId: string;
  path: string;
  createdAt: number;
  hash: string;
  size: number;
  chunkCount: number;
  contentType: "text" | "binary";
};

export type VersionRestoreResult = {
  restoredPath: string;
  createdPreRestoreBackup: boolean;
  preRestoreBackupPath: string;
};

export type VersionHistoryClient = {
  getOptionalDocument(id: string): Promise<LiveSyncDocument | undefined>;
  getDocumentsByIds(ids: string[]): Promise<Map<string, LiveSyncDocument>>;
  getVersionDocumentsForFile(fileId: string): Promise<LiveSyncDocument[]>;
  putVersionDocument(doc: LiveSyncDocument): Promise<boolean>;
  deleteDocuments(docs: LiveSyncDocument[]): Promise<number>;
};

export type VersionHistoryWriteClient = Pick<
  VersionHistoryClient,
  "getVersionDocumentsForFile" | "putVersionDocument" | "deleteDocuments"
>;

export const VERSION_DOCUMENT_PREFIX = "lls-version:";

function normalizeVaultPath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean)
    .join("/");
}

function folderOf(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

function versionPrefixForFile(fileId: string): string {
  return `${VERSION_DOCUMENT_PREFIX}${encodeURIComponent(fileId)}:`;
}

export function versionDocumentRangeForFile(fileId: string): { startKey: string; endKey: string } {
  const startKey = versionPrefixForFile(fileId);
  return {
    startKey,
    endKey: `${startKey}\ufff0`
  };
}

function versionDocumentId(fileId: string, createdAt: number, hash: string): string {
  const timestamp = String(createdAt).padStart(13, "0");
  return `${versionPrefixForFile(fileId)}${timestamp}:${encodeURIComponent(hash)}`;
}

function isVersionDocument(doc: LiveSyncDocument | undefined): doc is LiveSyncDocument & { versionFor: string } {
  return !!doc && doc.type === ENTRY_TYPES.VERSION_INFO && doc.llsVersion === true && typeof doc.versionFor === "string";
}

function versionSnapshot(doc: LiveSyncDocument): LiveSyncFileDocument | undefined {
  const snapshot = doc.versionSnapshot;
  return isLiveSyncFileDocument(snapshot) ? snapshot : undefined;
}

function versionCreatedAt(doc: LiveSyncDocument): number {
  return typeof doc.versionCreatedAt === "number" && Number.isFinite(doc.versionCreatedAt)
    ? doc.versionCreatedAt
    : 0;
}

function versionHash(doc: LiveSyncDocument): string {
  return typeof doc.versionHash === "string" ? doc.versionHash : "";
}

function legacyContent(doc: LiveSyncFileDocument): string {
  if (Array.isArray(doc.data)) {
    return doc.data.join("");
  }
  return typeof doc.data === "string" ? doc.data : "";
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function contentFromChunks(doc: LiveSyncFileDocument, chunks: LiveSyncChunkDocument[]): string | ArrayBuffer {
  const content = chunks.map((chunk) => chunk.data).join("");
  return doc.type === ENTRY_TYPES.NOTE_BINARY ? base64ToArrayBuffer(content) : content;
}

function edenChunk(doc: LiveSyncFileDocument, childId: string): LiveSyncChunkDocument | undefined {
  const value = doc.eden?.[childId];
  if (!value || typeof value !== "object" || typeof (value as { data?: unknown }).data !== "string") {
    return undefined;
  }
  return {
    _id: childId,
    type: ENTRY_TYPES.CHUNK,
    data: (value as { data: string }).data
  };
}

function retentionCutoff(retention: VersionHistoryRetention, now = Date.now()): number {
  const days = Math.max(1, retention.maxVersionAgeDays);
  return now - days * 24 * 60 * 60 * 1000;
}

export function buildVersionDocument(
  fileDocument: LiveSyncDocument,
  fingerprint: string,
  createdAt = Date.now()
): LiveSyncDocument {
  return {
    _id: versionDocumentId(fileDocument._id, createdAt, fingerprint),
    type: ENTRY_TYPES.VERSION_INFO,
    llsVersion: true,
    versionFor: fileDocument._id,
    versionCreatedAt: createdAt,
    versionHash: fingerprint,
    versionSnapshot: {
      ...fileDocument,
      _rev: undefined
    }
  };
}

export async function writeVersionForFile(
  client: VersionHistoryWriteClient,
  fileDocument: LiveSyncDocument,
  fingerprint: string,
  retention: VersionHistoryRetention
): Promise<VersionWriteResult> {
  const current = (await client.getVersionDocumentsForFile(fileDocument._id))
    .filter(isVersionDocument)
    .sort((left, right) => versionCreatedAt(right) - versionCreatedAt(left));

  if (current.some((doc) => versionHash(doc) === fingerprint)) {
    return { saved: 0, skipped: 1, pruned: await pruneVersionHistory(client, current, retention) };
  }

  const versionDocument = buildVersionDocument(fileDocument, fingerprint);
  const saved = await client.putVersionDocument(versionDocument);
  const next = saved
    ? [versionDocument, ...current]
    : current;
  return {
    saved: saved ? 1 : 0,
    skipped: saved ? 0 : 1,
    pruned: await pruneVersionHistory(client, next, retention)
  };
}

async function pruneVersionHistory(
  client: VersionHistoryWriteClient,
  documents: LiveSyncDocument[],
  retention: VersionHistoryRetention
): Promise<number> {
  const cutoff = retentionCutoff(retention);
  const maxVersions = Math.max(1, retention.maxVersionsPerFile);
  const sorted = documents
    .filter(isVersionDocument)
    .sort((left, right) => versionCreatedAt(right) - versionCreatedAt(left));
  const toDelete = sorted
    .filter((doc, index) => doc._rev && (index >= maxVersions || versionCreatedAt(doc) < cutoff));
  return client.deleteDocuments(toDelete);
}

export async function fileIdForVersionPath(
  path: string,
  passphrase: string,
  usePathObfuscation: boolean
): Promise<string> {
  return pathToLiveSyncDocumentId(normalizeVaultPath(path), usePathObfuscation ? passphrase : false, false);
}

export async function listFileVersions(
  client: VersionHistoryClient,
  path: string,
  options: DocumentTransformOptions,
  usePathObfuscation: boolean
): Promise<FileVersionEntry[]> {
  const fileId = await fileIdForVersionPath(path, options.passphrase, usePathObfuscation);
  const documents = await client.getVersionDocumentsForFile(fileId);
  const entries: FileVersionEntry[] = [];
  for (const doc of documents.filter(isVersionDocument)) {
    const snapshot = versionSnapshot(doc);
    if (!snapshot) {
      continue;
    }
    const decrypted = await decryptFileDocument(snapshot, options);
    entries.push({
      id: doc._id,
      fileId,
      path: decrypted.path,
      createdAt: versionCreatedAt(doc),
      hash: versionHash(doc),
      size: decrypted.size ?? 0,
      chunkCount: decrypted.children?.length ?? 0,
      contentType: decrypted.type === ENTRY_TYPES.NOTE_BINARY ? "binary" : "text"
    });
  }
  return entries.sort((left, right) => right.createdAt - left.createdAt);
}

export async function restoreFileVersion(
  client: VersionHistoryClient,
  adapter: DataAdapter,
  versionId: string,
  options: DocumentTransformOptions,
  conflictFolder: string
): Promise<VersionRestoreResult> {
  const version = await client.getOptionalDocument(versionId);
  if (!isVersionDocument(version)) {
    throw new Error("The selected version could not be found.");
  }

  const snapshot = versionSnapshot(version);
  if (!snapshot) {
    throw new Error("The selected version is missing its file metadata.");
  }

  const decrypted = await decryptFileDocument(snapshot, options);
  const restoredPath = normalizeVaultPath(decrypted.path);
  const content = await reconstructVersionContent(client, decrypted, options);
  let createdPreRestoreBackup = false;
  let preRestoreBackupPath = "";

  if (await adapter.exists(restoredPath)) {
    preRestoreBackupPath = await createRecoveryBackupForPath(adapter, restoredPath, conflictFolder);
    createdPreRestoreBackup = true;
  }

  await ensureRecoveryFolder(adapter, folderOf(restoredPath));
  if (typeof content === "string" && isTextSyncPath(restoredPath)) {
    await adapter.write(restoredPath, content);
  } else {
    const binary = typeof content === "string" ? new TextEncoder().encode(content).buffer : content;
    await adapter.writeBinary(restoredPath, binary);
  }

  return {
    restoredPath,
    createdPreRestoreBackup,
    preRestoreBackupPath
  };
}

async function reconstructVersionContent(
  client: VersionHistoryClient,
  doc: LiveSyncFileDocument,
  options: DocumentTransformOptions
): Promise<string | ArrayBuffer> {
  if (doc.type === ENTRY_TYPES.NOTE_LEGACY) {
    return legacyContent(doc);
  }

  const children = doc.children ?? [];
  const remoteChunks = await client.getDocumentsByIds(children);
  const chunks: LiveSyncChunkDocument[] = [];
  const missing: string[] = [];

  for (const childId of children) {
    const chunk = remoteChunks.get(childId) ?? edenChunk(doc, childId);
    if (!chunk) {
      missing.push(childId);
      continue;
    }
    if (!isLiveSyncChunkDocument(chunk)) {
      throw new Error(`A saved version references a non-content document: ${childId}`);
    }
    chunks.push(await decryptChunkDocument(chunk, options));
  }

  if (missing.length > 0) {
    throw new Error(`The selected version is missing ${missing.length} content chunk${missing.length === 1 ? "" : "s"}.`);
  }

  return contentFromChunks(doc, chunks);
}
