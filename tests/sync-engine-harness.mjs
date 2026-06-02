import assert from "node:assert/strict";
import { LightweightSyncEngine } from "../src/sync-engine.ts";
import { DEFAULT_SETTINGS } from "../src/settings.ts";

class MemoryStore {
  constructor(pendingPushes = [
    { path: "notes/a.md", deleted: false, queuedAt: 1, updatedAt: 1, attempts: 0, nextAttemptAt: 0, lastError: "" },
    { path: "notes/b.md", deleted: false, queuedAt: 2, updatedAt: 2, attempts: 0, nextAttemptAt: 0, lastError: "" },
    { path: "notes/c.md", deleted: false, queuedAt: 3, updatedAt: 3, attempts: 0, nextAttemptAt: 0, lastError: "" }
  ]) {
    this.pendingPushes = pendingPushes;
    this.lastRemoteSeq = "0";
    this.pendingApply = 0;
    this.fingerprints = new Map();
  }

  async getPendingLocalPushBatch(limit) {
    const now = Date.now();
    return this.pendingPushes
      .filter((change) => (change.nextAttemptAt ?? 0) <= now)
      .sort((left, right) => (left.nextAttemptAt ?? 0) - (right.nextAttemptAt ?? 0) || left.queuedAt - right.queuedAt)
      .slice(0, limit);
  }

  async markLocalPushSucceeded(paths) {
    this.pendingPushes = this.pendingPushes.filter((change) => !paths.includes(change.path));
  }

  async markLocalPushFailed(path, error, nextAttemptAt = Date.now()) {
    const change = this.pendingPushes.find((item) => item.path === path);
    if (change) {
      change.attempts += 1;
      change.lastError = error;
      change.nextAttemptAt = nextAttemptAt;
    }
  }

  async getLocalPushFingerprint(path) {
    return this.fingerprints.get(path) ?? "";
  }

  async setLocalPushFingerprint(path, fingerprint) {
    this.fingerprints.set(path, fingerprint);
  }

  async clearLocalPushFingerprints(paths) {
    for (const path of paths) {
      this.fingerprints.delete(path);
    }
  }

  async queueLocalChanges(changes) {
    const now = Date.now();
    for (const [index, change] of changes.entries()) {
      this.pendingPushes.push({
        path: change.path,
        deleted: change.deleted,
        queuedAt: now + index,
        updatedAt: now + index,
        attempts: 0,
        nextAttemptAt: 0,
        lastError: ""
      });
    }
    return this.getSummary();
  }

  async getCheckpoint() {
    return { lastRemoteSeq: this.lastRemoteSeq, updatedAt: 0 };
  }

  async cacheRemoteChanges(changes) {
    if (changes.length > 0) {
      this.lastRemoteSeq = String(changes.at(-1).seq);
      this.pendingApply += 1;
    }
    return this.getSummary();
  }

  async setCheckpoint(lastSeq) {
    this.lastRemoteSeq = String(lastSeq);
  }

  async getSummary() {
    return {
      files: this.pendingApply,
      chunks: 0,
      system: 0,
      unknown: 0,
      deleted: 0,
      pendingApply: this.pendingApply,
      pendingPush: this.pendingPushes.length,
      lastRemoteSeq: this.lastRemoteSeq
    };
  }
}

const store = new MemoryStore();
const putCalls = [];
let autoApplyCalls = 0;
let uiYields = 0;

const settings = {
  ...DEFAULT_SETTINGS,
  configured: true,
  couchDb: {
    ...DEFAULT_SETTINGS.couchDb,
    uri: "http://example.com:5984",
    database: "syncengine",
    username: "user",
    password: "password"
  },
  passphrase: "vault-passphrase",
  remoteState: {
    ...DEFAULT_SETTINGS.remoteState,
    syncParameterSalt: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
  },
  maxPushChangesPerSync: 2,
  autoApplyPull: true
};

const fakeClient = {
  async ensureDatabase() {
    return { created: false, info: { db_name: "syncengine", doc_count: 1, update_seq: "1" } };
  },
  async ensureSyncParameters() {
    return { created: false, parameters: {} };
  },
  async inspect() {
    return {
      serverVersion: "test",
      databaseName: "syncengine",
      documentCount: 1,
      updateSequence: "1",
      syncParametersPresent: true,
      syncParameterSalt: settings.remoteState.syncParameterSalt,
      milestonePresent: false,
      sample: { total: 1, notes: 1, chunks: 0, system: 0, deleted: 0, unknown: 0 }
    };
  },
  async getChangesSince() {
    return {
      lastSeq: "1",
      changes: [
        {
          id: "remote.md",
          seq: "1",
          doc: { _id: "remote.md", _rev: "1-r", type: "plain", path: "remote.md", children: [], mtime: 1, ctime: 1, size: 0 }
        }
      ]
    };
  },
  async deleteLiveSyncDocument() {
    return true;
  },
  async putLiveSyncBundle(fileDocument, chunkDocuments) {
    putCalls.push({ fileDocument, chunkDocuments });
    return { fileId: fileDocument._id, written: 1, reused: 0, conflicts: 0 };
  }
};

const engine = new LightweightSyncEngine({
  getSettings: () => settings,
  updateRemoteInspection: async () => {},
  updateLocalQueue: async () => {},
  getLocalStore: () => store,
  readLocalFileSnapshot: async (path) => ({
    path,
    content: `content for ${path}`,
    ctime: 1,
    mtime: 2,
    size: 10
  }),
  buildLocalPushBundle: async (snapshot) => ({
    fileDocument: { _id: snapshot.path, type: "plain", path: snapshot.path, children: [], ctime: 1, mtime: 2, size: 0 },
    chunkDocuments: []
  }),
  applyPulledChanges: async () => {
    autoApplyCalls += 1;
    store.pendingApply = Math.max(0, store.pendingApply - 1);
    return { applied: 1, deleted: 0, skipped: 0, merged: 0, backedUp: 0, conflicted: 0, failed: 0 };
  },
  createRemoteClient: () => fakeClient,
  yieldToUi: async () => {
    uiYields += 1;
  },
  log: () => {}
});

const outcome = await engine.sync("vault-change");

assert.equal(outcome.ok, true);
assert.equal(putCalls.length, 2);
assert.equal(uiYields, 6);
assert.equal(store.pendingPushes.length, 1);
assert.equal(autoApplyCalls, 1);
assert.equal((await store.getSummary()).pendingApply, 0);
assert.equal(outcome.metrics.pushedFiles, 2);
assert.equal(outcome.metrics.pulledChanges, 1);
assert.equal(outcome.metrics.appliedFiles, 1);
assert.equal(outcome.metrics.localBytesRead, 20);
assert.equal(outcome.metrics.remoteDocsWritten, 2);
assert.equal(outcome.metrics.chunkDocsBuilt, 0);
assert.ok(outcome.metrics.inspectMs >= 0);
assert.ok(outcome.metrics.pushMs >= 0);
assert.ok(outcome.metrics.pullMs >= 0);
assert.ok(outcome.metrics.applyMs >= 0);

const firstUploadStore = new MemoryStore([
  { path: "notes/first.md", deleted: false, queuedAt: 1, updatedAt: 1, attempts: 0, nextAttemptAt: 0, lastError: "" }
]);
let firstUploadPulled = false;
let firstUploadInspectCount = 0;
const firstUploadClient = {
  ...fakeClient,
  async inspect() {
    firstUploadInspectCount += 1;
    return {
      serverVersion: "test",
      databaseName: "syncengine",
      documentCount: firstUploadInspectCount === 1 ? 1 : 3,
      updateSequence: firstUploadInspectCount === 1 ? "1" : "3",
      syncParametersPresent: true,
      syncParameterSalt: settings.remoteState.syncParameterSalt,
      milestonePresent: false,
      sample: firstUploadInspectCount === 1
        ? { total: 0, notes: 0, chunks: 0, system: 0, deleted: 0, unknown: 0 }
        : { total: 2, notes: 1, chunks: 1, system: 0, deleted: 0, unknown: 0 }
    };
  },
  async getChangesSince() {
    firstUploadPulled = true;
    return { lastSeq: "3", changes: [] };
  },
  async putLiveSyncBundle() {
    return { fileId: "notes/first.md", written: 2, reused: 0, conflicts: 0 };
  }
};
const firstUploadEngine = new LightweightSyncEngine({
  getSettings: () => ({ ...settings, maxPushChangesPerSync: 10 }),
  updateRemoteInspection: async () => {},
  updateLocalQueue: async () => {},
  getLocalStore: () => firstUploadStore,
  readLocalFileSnapshot: async (path) => ({
    path,
    content: `content for ${path}`,
    ctime: 1,
    mtime: 2,
    size: 10
  }),
  buildLocalPushBundle: async (snapshot) => ({
    fileDocument: { _id: snapshot.path, type: "plain", path: snapshot.path, children: [], ctime: 1, mtime: 2, size: 0 },
    chunkDocuments: [{ _id: `h:${snapshot.path}`, type: "newnote", data: "chunk" }]
  }),
  applyPulledChanges: async () => {
    throw new Error("Should not apply own first-upload changes.");
  },
  createRemoteClient: () => firstUploadClient,
  log: () => {}
});
const firstUploadOutcome = await firstUploadEngine.sync("manual");
assert.equal(firstUploadOutcome.ok, true);
assert.equal(firstUploadPulled, false);
assert.equal(firstUploadStore.lastRemoteSeq, "3");
assert.equal((await firstUploadStore.getSummary()).pendingApply, 0);
assert.equal(firstUploadOutcome.metrics.pushedFiles, 1);
assert.equal(firstUploadOutcome.metrics.pulledChanges, 0);

const automaticFirstStore = new MemoryStore([]);
let automaticFirstQueued = false;
let automaticFirstPulled = false;
let automaticFirstInspectCount = 0;
const automaticFirstClient = {
  ...fakeClient,
  async inspect() {
    automaticFirstInspectCount += 1;
    return {
      serverVersion: "test",
      databaseName: "syncengine",
      documentCount: automaticFirstInspectCount === 1 ? 1 : 3,
      updateSequence: automaticFirstInspectCount === 1 ? "1" : "3",
      syncParametersPresent: true,
      syncParameterSalt: settings.remoteState.syncParameterSalt,
      milestonePresent: false,
      sample: automaticFirstInspectCount === 1
        ? { total: 0, notes: 0, chunks: 0, system: 0, deleted: 0, unknown: 0 }
        : { total: 2, notes: 1, chunks: 1, system: 0, deleted: 0, unknown: 0 }
    };
  },
  async getChangesSince() {
    automaticFirstPulled = true;
    return { lastSeq: "3", changes: [] };
  },
  async putLiveSyncBundle() {
    return { fileId: "notes/auto.md", written: 2, reused: 0, conflicts: 0 };
  }
};
const automaticFirstEngine = new LightweightSyncEngine({
  getSettings: () => ({ ...settings, maxPushChangesPerSync: 10 }),
  updateRemoteInspection: async () => {},
  updateLocalQueue: async () => {},
  queueCurrentVaultForSync: async () => {
    automaticFirstQueued = true;
    return automaticFirstStore.queueLocalChanges([{ path: "notes/auto.md", deleted: false }]);
  },
  getLocalStore: () => automaticFirstStore,
  readLocalFileSnapshot: async (path) => ({
    path,
    content: `content for ${path}`,
    ctime: 1,
    mtime: 2,
    size: 10
  }),
  buildLocalPushBundle: async (snapshot) => ({
    fileDocument: { _id: snapshot.path, type: "plain", path: snapshot.path, children: [], ctime: 1, mtime: 2, size: 0 },
    chunkDocuments: [{ _id: `h:${snapshot.path}`, type: "newnote", data: "chunk" }]
  }),
  applyPulledChanges: async () => {
    throw new Error("Should not apply own automatic first-upload changes.");
  },
  createRemoteClient: () => automaticFirstClient,
  log: () => {}
});
const automaticFirstOutcome = await automaticFirstEngine.sync("setup-import");
assert.equal(automaticFirstQueued, true);
assert.equal(automaticFirstOutcome.ok, true);
assert.equal(automaticFirstPulled, false);
assert.equal(automaticFirstStore.lastRemoteSeq, "3");
assert.equal((await automaticFirstStore.getSummary()).pendingApply, 0);
assert.equal(automaticFirstOutcome.metrics.pushedFiles, 1);
assert.equal(automaticFirstOutcome.metrics.pulledChanges, 0);

const retryStore = new MemoryStore([
  { path: "notes/cooling.md", deleted: false, queuedAt: 1, updatedAt: 1, attempts: 1, nextAttemptAt: Date.now() + 600_000, lastError: "offline" },
  { path: "notes/fail.md", deleted: false, queuedAt: 2, updatedAt: 2, attempts: 0, nextAttemptAt: 0, lastError: "" },
  { path: "notes/after.md", deleted: false, queuedAt: 3, updatedAt: 3, attempts: 0, nextAttemptAt: 0, lastError: "" }
]);
const retryPutCalls = [];
const retrySettings = {
  ...settings,
  maxPushChangesPerSync: 2,
  failedPushRetryBaseSec: 60,
  failedPushRetryMaxSec: 120
};
const retryClient = {
  ...fakeClient,
  async getChangesSince() {
    return { lastSeq: "0", changes: [] };
  },
  async putLiveSyncBundle(fileDocument, chunkDocuments) {
    if (fileDocument._id === "notes/fail.md") {
      throw new Error("offline");
    }
    retryPutCalls.push({ fileDocument, chunkDocuments });
    return { fileId: fileDocument._id, written: 1, reused: 0, conflicts: 0 };
  }
};
const retryEngine = new LightweightSyncEngine({
  getSettings: () => retrySettings,
  updateRemoteInspection: async () => {},
  updateLocalQueue: async () => {},
  getLocalStore: () => retryStore,
  readLocalFileSnapshot: async (path) => ({
    path,
    content: `content for ${path}`,
    ctime: 1,
    mtime: 2,
    size: 10
  }),
  buildLocalPushBundle: async (snapshot) => ({
    fileDocument: { _id: snapshot.path, type: "plain", path: snapshot.path, children: [], ctime: 1, mtime: 2, size: 0 },
    chunkDocuments: []
  }),
  applyPulledChanges: async () => ({ applied: 0, deleted: 0, skipped: 0, merged: 0, backedUp: 0, conflicted: 0, failed: 0 }),
  createRemoteClient: () => retryClient,
  log: () => {}
});
const retryStartedAt = Date.now();
const retryOutcome = await retryEngine.sync("periodic");
const failedRetry = retryStore.pendingPushes.find((change) => change.path === "notes/fail.md");

assert.equal(retryOutcome.ok, true);
assert.equal(retryPutCalls.length, 1);
assert.equal(retryPutCalls[0].fileDocument._id, "notes/after.md");
assert.equal(retryStore.pendingPushes.some((change) => change.path === "notes/cooling.md"), true);
assert.equal(failedRetry.attempts, 1);
assert.ok(failedRetry.nextAttemptAt >= retryStartedAt + 60_000);
assert.equal(retryOutcome.metrics.pushedFiles, 1);
assert.equal(retryOutcome.metrics.failedFiles, 1);
assert.equal(retryOutcome.metrics.localBytesRead, 10);

const noOpStore = new MemoryStore([
  { path: "notes/same.md", deleted: false, queuedAt: 1, updatedAt: 1, attempts: 0, nextAttemptAt: 0, lastError: "" }
]);
const sameSnapshot = {
  path: "notes/same.md",
  content: "same content",
  ctime: 1,
  mtime: 2,
  size: 12
};
const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(sameSnapshot.content));
const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
await noOpStore.setLocalPushFingerprint(sameSnapshot.path, `text:${sameSnapshot.size}:${hex}`);
let noOpPutCalls = 0;
let noOpBuildCalls = 0;
const noOpEngine = new LightweightSyncEngine({
  getSettings: () => settings,
  updateRemoteInspection: async () => {},
  updateLocalQueue: async () => {},
  getLocalStore: () => noOpStore,
  readLocalFileSnapshot: async () => sameSnapshot,
  buildLocalPushBundle: async () => {
    noOpBuildCalls += 1;
    throw new Error("No-op push should not build a bundle.");
  },
  applyPulledChanges: async () => ({ applied: 0, deleted: 0, skipped: 0, merged: 0, backedUp: 0, conflicted: 0, failed: 0 }),
  createRemoteClient: () => ({
    ...fakeClient,
    async getChangesSince() {
      return { lastSeq: "0", changes: [] };
    },
    async putLiveSyncBundle() {
      noOpPutCalls += 1;
      throw new Error("No-op push should not write to CouchDB.");
    }
  }),
  log: () => {}
});
const noOpOutcome = await noOpEngine.sync("vault-change");
assert.equal(noOpOutcome.ok, true);
assert.equal(noOpStore.pendingPushes.length, 0);
assert.equal(noOpBuildCalls, 0);
assert.equal(noOpPutCalls, 0);
assert.equal(noOpOutcome.metrics.skippedFiles, 1);
assert.equal(noOpOutcome.metrics.pushedFiles, 0);
assert.equal(noOpOutcome.metrics.remoteDocsWritten, 0);
assert.equal(noOpOutcome.metrics.localBytesRead, 12);

class PullBatchStore extends MemoryStore {
  constructor() {
    super([]);
    this.cacheBatchSizes = [];
  }

  async cacheRemoteChanges(changes) {
    this.cacheBatchSizes.push(changes.length);
    if (changes.length > 0) {
      this.lastRemoteSeq = String(changes.at(-1).seq);
      this.pendingApply += changes.length;
    }
    return this.getSummary();
  }
}

const pullBatchStore = new PullBatchStore();
let pullBatchYields = 0;
const pullBacklog = Array.from({ length: 60 }, (_, index) => {
  const seq = String(index + 1);
  return {
    id: `remote-${seq}.md`,
    seq,
    doc: { _id: `remote-${seq}.md`, _rev: `1-${seq}`, type: "plain", path: `remote-${seq}.md`, children: [], mtime: 1, ctime: 1, size: 0 }
  };
});
const pullBatchEngine = new LightweightSyncEngine({
  getSettings: () => ({
    ...settings,
    autoApplyPull: false,
    maxPushChangesPerSync: 1
  }),
  updateRemoteInspection: async () => {},
  updateLocalQueue: async () => {},
  getLocalStore: () => pullBatchStore,
  readLocalFileSnapshot: async () => undefined,
  buildLocalPushBundle: async () => {
    throw new Error("Pull-only sync should not build a local bundle.");
  },
  applyPulledChanges: async () => {
    throw new Error("Auto apply is disabled for this pull batching check.");
  },
  createRemoteClient: () => ({
    ...fakeClient,
    async getChangesSince() {
      return { lastSeq: "60", changes: pullBacklog };
    }
  }),
  yieldToUi: async () => {
    pullBatchYields += 1;
  },
  log: () => {}
});
const pullBatchOutcome = await pullBatchEngine.sync("periodic");
assert.equal(pullBatchOutcome.ok, true);
assert.deepEqual(pullBatchStore.cacheBatchSizes, [25, 25, 10]);
assert.equal(pullBatchYields, 6);
assert.equal(pullBatchOutcome.metrics.pulledChanges, 60);
assert.equal((await pullBatchStore.getSummary()).pendingApply, 60);

let offlineClientCalls = 0;
const offlineStore = new MemoryStore([]);
const offlineEngine = new LightweightSyncEngine({
  getSettings: () => settings,
  updateRemoteInspection: async () => {},
  updateLocalQueue: async () => {},
  getLocalStore: () => offlineStore,
  readLocalFileSnapshot: async () => undefined,
  buildLocalPushBundle: async () => {
    throw new Error("Offline automatic sync must not build local bundles.");
  },
  applyPulledChanges: async () => ({ applied: 0, deleted: 0, skipped: 0, merged: 0, backedUp: 0, conflicted: 0, failed: 0 }),
  createRemoteClient: () => ({
    ...fakeClient,
    async inspect() {
      offlineClientCalls += 1;
      return fakeClient.inspect();
    },
    async getChangesSince() {
      return { lastSeq: "0", changes: [] };
    }
  }),
  isNetworkLikelyOnline: () => false,
  log: () => {}
});
const offlineAutomatic = await offlineEngine.sync("periodic");
assert.equal(offlineAutomatic.ok, false);
assert.match(offlineAutomatic.message, /offline/);
assert.equal(offlineClientCalls, 0);
const offlineManual = await offlineEngine.sync("manual");
assert.equal(offlineManual.ok, true);
assert.equal(offlineClientCalls, 1);

let additionalDeviceEnsureCalls = 0;
const additionalDeviceEngine = new LightweightSyncEngine({
  getSettings: () => ({
    ...settings,
    deviceSetupRole: "additional-device"
  }),
  updateRemoteInspection: async () => {},
  updateLocalQueue: async () => {},
  getLocalStore: () => store,
  readLocalFileSnapshot: async () => undefined,
  buildLocalPushBundle: async () => {
    throw new Error("Additional-device initialization must not build local bundles.");
  },
  applyPulledChanges: async () => ({ applied: 0, deleted: 0, skipped: 0, merged: 0, backedUp: 0, conflicted: 0, failed: 0 }),
  createRemoteClient: () => ({
    ...fakeClient,
    async ensureDatabase() {
      additionalDeviceEnsureCalls += 1;
      throw new Error("Additional-device initialization must not create a database.");
    },
    async ensureSyncParameters() {
      additionalDeviceEnsureCalls += 1;
      throw new Error("Additional-device initialization must not create sync parameters.");
    }
  }),
  log: () => {}
});
const additionalDeviceInitialise = await additionalDeviceEngine.initialiseRemote();
assert.equal(additionalDeviceInitialise.ok, false);
assert.match(additionalDeviceInitialise.message, /original device/);
assert.equal(additionalDeviceEnsureCalls, 0);

console.log(JSON.stringify({
  ok: true,
  pushedThisSync: putCalls.length,
  uiYields,
  remainingPushes: store.pendingPushes.length,
  autoApplyCalls,
  metrics: outcome.metrics,
  retryBackoffSeconds: Math.ceil((failedRetry.nextAttemptAt - retryStartedAt) / 1000),
  retryDidNotBlockDuePush: retryPutCalls[0].fileDocument._id,
  noOpSkippedWithoutNetworkWrite: noOpOutcome.metrics.skippedFiles,
  automaticFirstSyncQueued: automaticFirstQueued,
  automaticFirstSyncPulledOwnUpload: automaticFirstPulled,
  pullCacheBatchSizes: pullBatchStore.cacheBatchSizes,
  pullCacheYields: pullBatchYields,
  offlineAutomatic: offlineAutomatic.message,
  offlineManualTriedNetwork: offlineClientCalls === 1,
  additionalDeviceInitialise: additionalDeviceInitialise.message,
  message: outcome.message
}, null, 2));
