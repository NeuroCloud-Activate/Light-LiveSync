import {
  isLiveSyncChunkDocument,
  isLiveSyncFileDocument,
  isLiveSyncSystemDocument,
  type LiveSyncDocument
} from "./livesync-constants";

const STORE_VERSION = 4;
const DOCUMENT_STORE = "documents";
const STATE_STORE = "state";
const PUSH_STORE = "pendingPushes";
const PUSH_FINGERPRINT_STORE = "pushedFingerprints";
const KEY_CHECKPOINT = "checkpoint";

export type LocalSyncCheckpoint = {
  lastRemoteSeq: string;
  updatedAt: number;
};

export type CachedRemoteDocument = {
  id: string;
  rev: string;
  seq: string;
  pulledAt: number;
  stagedAt: number;
  appliedAt: number;
  deleted: boolean;
  kind: "file" | "chunk" | "system" | "unknown";
  doc?: LiveSyncDocument;
};

export type LocalStoreSummary = {
  files: number;
  chunks: number;
  system: number;
  unknown: number;
  deleted: number;
  pendingApply: number;
  pendingPush: number;
  lastRemoteSeq: string;
};

export type PendingLocalPush = {
  path: string;
  deleted: boolean;
  queuedAt: number;
  updatedAt: number;
  attempts: number;
  nextAttemptAt: number;
  lastError: string;
};

export type LocalChangeToQueue = {
  path: string;
  deleted: boolean;
};

export type LocalPushFingerprint = {
  path: string;
  fingerprint: string;
  updatedAt: number;
};

export type RemoteDocumentChange = {
  id: string;
  seq: string | number;
  deleted?: boolean;
  doc?: LiveSyncDocument;
};

function dbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function txDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
  });
}

function classifyDocument(id: string, doc: LiveSyncDocument | undefined): CachedRemoteDocument["kind"] {
  if (isLiveSyncFileDocument(doc)) {
    return "file";
  }
  if (isLiveSyncChunkDocument(doc)) {
    return "chunk";
  }
  if (isLiveSyncSystemDocument(doc, id)) {
    return "system";
  }
  return "unknown";
}

function documentHasKnownKind(doc: LiveSyncDocument | undefined): boolean {
  return isLiveSyncFileDocument(doc) || isLiveSyncChunkDocument(doc) || isLiveSyncSystemDocument(doc);
}

function normaliseDatabaseName(value: string): string {
  return value.replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
}

function localDatabaseName(databaseName: string): string {
  return `light-livesync-${normaliseDatabaseName(databaseName || "default")}`;
}

function compareSeq(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return left.localeCompare(right);
}

export class LocalDocumentStore {
  private db?: IDBDatabase;

  constructor(private readonly databaseName: string) {}

  static async deleteDatabase(databaseName: string): Promise<void> {
    if (!databaseName || typeof indexedDB === "undefined") {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(localDatabaseName(databaseName));
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("Could not clear local sync queue."));
      request.onblocked = () => reject(new Error("Could not clear local sync queue because another tab is still using it."));
    });
  }

  async open(): Promise<void> {
    if (this.db) {
      return;
    }

    const name = localDatabaseName(this.databaseName);
    const request = indexedDB.open(name, STORE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DOCUMENT_STORE)) {
        const documents = db.createObjectStore(DOCUMENT_STORE, { keyPath: "id" });
        documents.createIndex("kind", "kind", { unique: false });
        documents.createIndex("stagedAt", "stagedAt", { unique: false });
        documents.createIndex("appliedAt", "appliedAt", { unique: false });
        documents.createIndex("seq", "seq", { unique: false });
      } else {
        const documents = request.transaction?.objectStore(DOCUMENT_STORE);
        if (documents && !documents.indexNames.contains("stagedAt")) {
          documents.createIndex("stagedAt", "stagedAt", { unique: false });
        }
      }
      if (!db.objectStoreNames.contains(STATE_STORE)) {
        db.createObjectStore(STATE_STORE);
      }
      if (!db.objectStoreNames.contains(PUSH_STORE)) {
        const pushes = db.createObjectStore(PUSH_STORE, { keyPath: "path" });
        pushes.createIndex("queuedAt", "queuedAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(PUSH_FINGERPRINT_STORE)) {
        db.createObjectStore(PUSH_FINGERPRINT_STORE, { keyPath: "path" });
      }
    };
    this.db = await dbRequest(request);
  }

  close(): void {
    this.db?.close();
    this.db = undefined;
  }

  async getCheckpoint(): Promise<LocalSyncCheckpoint> {
    const db = await this.requireDb();
    const transaction = db.transaction(STATE_STORE, "readonly");
    const done = txDone(transaction);
    const store = transaction.objectStore(STATE_STORE);
    const checkpoint = await dbRequest<LocalSyncCheckpoint | undefined>(store.get(KEY_CHECKPOINT));
    await done;
    return checkpoint ?? { lastRemoteSeq: "0", updatedAt: 0 };
  }

  async setCheckpoint(lastRemoteSeq: string): Promise<void> {
    const db = await this.requireDb();
    const transaction = db.transaction(STATE_STORE, "readwrite");
    const done = txDone(transaction);
    transaction.objectStore(STATE_STORE).put({ lastRemoteSeq, updatedAt: Date.now() } satisfies LocalSyncCheckpoint, KEY_CHECKPOINT);
    await done;
  }

  async cacheRemoteChanges(changes: RemoteDocumentChange[]): Promise<LocalStoreSummary> {
    const db = await this.requireDb();
    const pulledAt = Date.now();
    const transaction = db.transaction([DOCUMENT_STORE, STATE_STORE], "readwrite");
    const done = txDone(transaction);
    const documents = transaction.objectStore(DOCUMENT_STORE);
    const state = transaction.objectStore(STATE_STORE);
    let lastSeq = "";

    for (const change of changes) {
      lastSeq = String(change.seq);
      const previous = await dbRequest<CachedRemoteDocument | undefined>(documents.get(change.id));
      const changeDeleted = !!change.deleted || !!change.doc?._deleted;
      const doc =
        changeDeleted && !documentHasKnownKind(change.doc) && previous?.doc
          ? {
              ...previous.doc,
              _rev: change.doc?._rev ?? previous.rev,
              _deleted: true,
              deleted: true
            }
          : change.doc;
      const cached: CachedRemoteDocument = {
        id: change.id,
        rev: doc?._rev ?? change.doc?._rev ?? previous?.rev ?? "",
        seq: String(change.seq),
        pulledAt,
        stagedAt: 0,
        appliedAt: 0,
        deleted: changeDeleted || !!doc?._deleted,
        kind: classifyDocument(change.id, doc),
        doc
      };
      documents.put(cached);
    }

    if (lastSeq) {
      state.put({ lastRemoteSeq: lastSeq, updatedAt: pulledAt } satisfies LocalSyncCheckpoint, KEY_CHECKPOINT);
    }

    await done;
    return this.getSummary();
  }

  async getPendingApplyBatch(limit: number): Promise<CachedRemoteDocument[]> {
    return this.getPendingFileBatch(limit, "appliedAt");
  }

  async getPendingStagingBatch(limit: number): Promise<CachedRemoteDocument[]> {
    return this.getPendingFileBatch(limit, "stagedAt");
  }

  private async getPendingFileBatch(limit: number, field: "appliedAt" | "stagedAt"): Promise<CachedRemoteDocument[]> {
    const db = await this.requireDb();
    const transaction = db.transaction(DOCUMENT_STORE, "readonly");
    const done = txDone(transaction);
    const store = transaction.objectStore(DOCUMENT_STORE);
    const items = await dbRequest<CachedRemoteDocument[]>(store.index("kind").getAll("file"));
    await done;
    return items
      .filter((item) => (item[field] ?? 0) === 0)
      .sort((left, right) => compareSeq(left.seq, right.seq))
      .slice(0, limit);
  }

  async getCachedDocuments(ids: string[]): Promise<Map<string, CachedRemoteDocument>> {
    const db = await this.requireDb();
    const transaction = db.transaction(DOCUMENT_STORE, "readonly");
    const done = txDone(transaction);
    const store = transaction.objectStore(DOCUMENT_STORE);
    const requests = ids.map(async (id) => [id, await dbRequest<CachedRemoteDocument | undefined>(store.get(id))] as const);
    const results = await Promise.all(requests);
    await done;
    return new Map(results.filter((entry): entry is readonly [string, CachedRemoteDocument] => !!entry[1]));
  }

  async queueLocalChange(path: string, deleted: boolean): Promise<LocalStoreSummary> {
    return this.queueLocalChanges([{ path, deleted }]);
  }

  async queueLocalChanges(changes: LocalChangeToQueue[]): Promise<LocalStoreSummary> {
    const uniqueChanges = new Map<string, LocalChangeToQueue>();
    for (const change of changes) {
      if (change.path) {
        uniqueChanges.set(change.path, change);
      }
    }

    if (uniqueChanges.size === 0) {
      return this.getSummary();
    }

    const db = await this.requireDb();
    const now = Date.now();
    const transaction = db.transaction(PUSH_STORE, "readwrite");
    const done = txDone(transaction);
    const store = transaction.objectStore(PUSH_STORE);
    for (const change of uniqueChanges.values()) {
      const existing = await dbRequest<PendingLocalPush | undefined>(store.get(change.path));
      store.put({
        path: change.path,
        deleted: change.deleted,
        queuedAt: existing?.queuedAt ?? now,
        updatedAt: now,
        attempts: existing?.attempts ?? 0,
        nextAttemptAt: 0,
        lastError: ""
      } satisfies PendingLocalPush);
    }
    await done;
    return this.getSummary();
  }

  async getPendingLocalPushBatch(limit: number): Promise<PendingLocalPush[]> {
    const db = await this.requireDb();
    const transaction = db.transaction(PUSH_STORE, "readonly");
    const done = txDone(transaction);
    const store = transaction.objectStore(PUSH_STORE);
    const items = await dbRequest<PendingLocalPush[]>(store.getAll());
    await done;
    const now = Date.now();
    return items
      .filter((item) => (item.nextAttemptAt ?? 0) <= now)
      .sort((left, right) => {
        const leftNext = left.nextAttemptAt ?? 0;
        const rightNext = right.nextAttemptAt ?? 0;
        return leftNext - rightNext || left.queuedAt - right.queuedAt;
      })
      .slice(0, limit);
  }

  async markLocalPushSucceeded(paths: string[]): Promise<void> {
    if (paths.length === 0) {
      return;
    }
    const db = await this.requireDb();
    const transaction = db.transaction(PUSH_STORE, "readwrite");
    const done = txDone(transaction);
    const store = transaction.objectStore(PUSH_STORE);
    for (const path of paths) {
      store.delete(path);
    }
    await done;
  }

  async markLocalPushFailed(path: string, error: string, nextAttemptAt = Date.now()): Promise<void> {
    const db = await this.requireDb();
    const transaction = db.transaction(PUSH_STORE, "readwrite");
    const done = txDone(transaction);
    const store = transaction.objectStore(PUSH_STORE);
    const existing = await dbRequest<PendingLocalPush | undefined>(store.get(path));
    if (existing) {
      store.put({
        ...existing,
        updatedAt: Date.now(),
        attempts: existing.attempts + 1,
        nextAttemptAt,
        lastError: error
      });
    }
    await done;
  }

  async getLocalPushFingerprint(path: string): Promise<string> {
    const db = await this.requireDb();
    const transaction = db.transaction(PUSH_FINGERPRINT_STORE, "readonly");
    const done = txDone(transaction);
    const store = transaction.objectStore(PUSH_FINGERPRINT_STORE);
    const existing = await dbRequest<LocalPushFingerprint | undefined>(store.get(path));
    await done;
    return existing?.fingerprint ?? "";
  }

  async setLocalPushFingerprint(path: string, fingerprint: string): Promise<void> {
    const db = await this.requireDb();
    const transaction = db.transaction(PUSH_FINGERPRINT_STORE, "readwrite");
    const done = txDone(transaction);
    transaction.objectStore(PUSH_FINGERPRINT_STORE).put({
      path,
      fingerprint,
      updatedAt: Date.now()
    } satisfies LocalPushFingerprint);
    await done;
  }

  async clearLocalPushFingerprints(paths: string[]): Promise<void> {
    if (paths.length === 0) {
      return;
    }
    const db = await this.requireDb();
    const transaction = db.transaction(PUSH_FINGERPRINT_STORE, "readwrite");
    const done = txDone(transaction);
    const store = transaction.objectStore(PUSH_FINGERPRINT_STORE);
    for (const path of paths) {
      store.delete(path);
    }
    await done;
  }

  async markApplied(ids: string[]): Promise<void> {
    await this.markProcessed(ids, "appliedAt");
  }

  async markStaged(ids: string[]): Promise<void> {
    await this.markProcessed(ids, "stagedAt");
  }

  private async markProcessed(ids: string[], field: "appliedAt" | "stagedAt"): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    const db = await this.requireDb();
    const appliedAt = Date.now();
    const transaction = db.transaction(DOCUMENT_STORE, "readwrite");
    const done = txDone(transaction);
    const store = transaction.objectStore(DOCUMENT_STORE);
    for (const id of ids) {
      const item = await dbRequest<CachedRemoteDocument | undefined>(store.get(id));
      if (item) {
        store.put({ ...item, [field]: appliedAt });
      }
    }
    await done;
  }

  async getSummary(): Promise<LocalStoreSummary> {
    const db = await this.requireDb();
    const transaction = db.transaction([DOCUMENT_STORE, STATE_STORE, PUSH_STORE], "readonly");
    const done = txDone(transaction);
    const documents = transaction.objectStore(DOCUMENT_STORE);
    const checkpoint = await dbRequest<LocalSyncCheckpoint | undefined>(
      transaction.objectStore(STATE_STORE).get(KEY_CHECKPOINT)
    );
    const summary: LocalStoreSummary = {
      files: 0,
      chunks: 0,
      system: 0,
      unknown: 0,
      deleted: 0,
      pendingApply: 0,
      pendingPush: 0,
      lastRemoteSeq: checkpoint?.lastRemoteSeq ?? "0"
    };

    await new Promise<void>((resolve, reject) => {
      const request = documents.openCursor();
      request.onerror = () => reject(request.error ?? new Error("Could not read local queue summary."));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }

        const item = cursor.value as CachedRemoteDocument;
        if (item.kind === "file") summary.files++;
        if (item.kind === "chunk") summary.chunks++;
        if (item.kind === "system") summary.system++;
        if (item.kind === "unknown") summary.unknown++;
        if (item.deleted) summary.deleted++;
        if (item.kind === "file" && item.appliedAt === 0) summary.pendingApply++;
        cursor.continue();
      };
    });

    summary.pendingPush = await dbRequest<number>(transaction.objectStore(PUSH_STORE).count());
    await done;

    return summary;
  }

  private async requireDb(): Promise<IDBDatabase> {
    await this.open();
    if (!this.db) {
      throw new Error("Local document store is not open.");
    }
    return this.db;
  }
}
