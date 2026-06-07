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
const progressEvents = [];
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
  },
  async putLiveSyncBundles(bundles) {
    putCalls.push({ bundles });
    return { fileIds: bundles.map((bundle) => bundle.fileDocument._id), written: bundles.length, reused: 0, conflicts: 0 };
  },
  async getVersionDocumentsForFile() {
    return [];
  },
  async putVersionDocument() {
    return true;
  },
  async deleteDocuments() {
    return 0;
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
    return { applied: 1, deleted: 0, skipped: 0, waiting: 0, merged: 0, backedUp: 0, conflicted: 0, failed: 0 };
  },
  createRemoteClient: () => fakeClient,
  yieldToUi: async () => {
    uiYields += 1;
  },
  log: () => {},
  reportProgress: (progress) => progressEvents.push(progress)
});

const outcome = await engine.sync("vault-change");

assert.equal(outcome.ok, true);
assert.equal(putCalls.length, 1);
assert.equal(putCalls[0].bundles.length, 2);
assert.equal(uiYields, 8);
assert.equal(store.pendingPushes.length, 1);
assert.equal(autoApplyCalls, 1);
assert.equal((await store.getSummary()).pendingApply, 0);
assert.equal(outcome.metrics.pushedFiles, 2);
assert.equal(outcome.metrics.pulledChanges, 1);
assert.equal(outcome.metrics.appliedFiles, 1);
assert.equal(outcome.metrics.localBytesRead, 20);
assert.equal(outcome.metrics.remoteDocsWritten, 2);
assert.equal(outcome.metrics.chunkDocsBuilt, 0);
assert.equal(outcome.metrics.versionsSaved, 2);
assert.equal(outcome.metrics.versionsFailed, 0);
assert.ok(outcome.metrics.inspectMs >= 0);
assert.ok(outcome.metrics.pushMs >= 0);
assert.ok(outcome.metrics.pullMs >= 0);
assert.ok(outcome.metrics.applyMs >= 0);
assert.equal(progressEvents.some((event) => event.phase === "inspect-start"), true);
assert.equal(progressEvents.some((event) => event.phase === "push-start" && event.total === 2), true);
assert.equal(progressEvents.some((event) => event.phase === "push-file-complete" && event.completed === 2 && event.bytes === 20), true);
assert.equal(progressEvents.some((event) => event.phase === "pull-start"), true);
assert.equal(progressEvents.some((event) => event.phase === "pull-batch" && event.completed === 1), true);
assert.equal(progressEvents.some((event) => event.phase === "apply-start" && event.pending === 1), true);

const firstUploadStore = new MemoryStore([
  { path: "notes/first.md", deleted: false, queuedAt: 1, updatedAt: 1, attempts: 0, nextAttemptAt: 0, lastError: "" }
]);
let firstUploadPulled = false;
let firstUploadInspectCount = 0;
const firstUploadInspectSamples = [];
const firstUploadClient = {
  ...fakeClient,
  async inspect(options = {}) {
    firstUploadInspectCount += 1;
    firstUploadInspectSamples.push(options.includeRecentChangesSample === true);
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
  },
  async putLiveSyncBundles(bundles) {
    return { fileIds: bundles.map((bundle) => bundle.fileDocument._id), written: 2, reused: 0, conflicts: 0 };
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
assert.deepEqual(firstUploadInspectSamples, [true, false]);
assert.equal(firstUploadStore.lastRemoteSeq, "3");
assert.equal((await firstUploadStore.getSummary()).pendingApply, 0);
assert.equal(firstUploadOutcome.metrics.pushedFiles, 1);
assert.equal(firstUploadOutcome.metrics.pulledChanges, 0);

const automaticFirstStore = new MemoryStore([]);
let automaticFirstQueued = false;
let automaticFirstPulled = false;
let automaticFirstInspectCount = 0;
const automaticFirstInspectSamples = [];
const automaticFirstClient = {
  ...fakeClient,
  async inspect(options = {}) {
    automaticFirstInspectCount += 1;
    automaticFirstInspectSamples.push(options.includeRecentChangesSample === true);
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
  },
  async putLiveSyncBundles(bundles) {
    return { fileIds: bundles.map((bundle) => bundle.fileDocument._id), written: 2, reused: 0, conflicts: 0 };
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
assert.deepEqual(automaticFirstInspectSamples, [true, false]);
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
  },
  async putLiveSyncBundles(bundles) {
    if (bundles.some((bundle) => bundle.fileDocument._id === "notes/fail.md")) {
      throw new Error("offline");
    }
    retryPutCalls.push({ bundles });
    return { fileIds: bundles.map((bundle) => bundle.fileDocument._id), written: bundles.length, reused: 0, conflicts: 0 };
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
  applyPulledChanges: async () => ({ applied: 0, deleted: 0, skipped: 0, waiting: 0, merged: 0, backedUp: 0, conflicted: 0, failed: 0 }),
  createRemoteClient: () => retryClient,
  log: () => {}
});
const retryStartedAt = Date.now();
const retryOutcome = await retryEngine.sync("periodic");
const failedRetry = retryStore.pendingPushes.find((change) => change.path === "notes/fail.md");

assert.equal(retryOutcome.ok, true);
assert.equal(retryPutCalls.length, 1);
assert.equal(retryPutCalls[0].bundles[0].fileDocument._id, "notes/after.md");
assert.equal(retryStore.pendingPushes.some((change) => change.path === "notes/cooling.md"), true);
assert.equal(failedRetry.attempts, 1);
assert.ok(failedRetry.nextAttemptAt >= retryStartedAt + 60_000);
assert.equal(retryOutcome.metrics.pushedFiles, 1);
assert.equal(retryOutcome.metrics.failedFiles, 1);
assert.equal(retryOutcome.metrics.localBytesRead, 20);

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
  applyPulledChanges: async () => ({ applied: 0, deleted: 0, skipped: 0, waiting: 0, merged: 0, backedUp: 0, conflicted: 0, failed: 0 }),
  createRemoteClient: () => ({
    ...fakeClient,
    async getChangesSince() {
      return { lastSeq: "0", changes: [] };
    },
    async putLiveSyncBundle() {
      noOpPutCalls += 1;
      throw new Error("No-op push should not write to CouchDB.");
    },
    async putLiveSyncBundles() {
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

const metadataNoOpStore = new MemoryStore([
  { path: "notes/metadata-same.md", deleted: false, queuedAt: 1, updatedAt: 1, attempts: 0, nextAttemptAt: 0, lastError: "" }
]);
const metadataSnapshot = {
  path: "notes/metadata-same.md",
  content: "metadata same",
  ctime: 1,
  mtime: 20,
  size: 13
};
const metadataDigest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(metadataSnapshot.content));
const metadataHex = Array.from(new Uint8Array(metadataDigest), (byte) => byte.toString(16).padStart(2, "0")).join("");
await metadataNoOpStore.setLocalPushFingerprint(
  metadataSnapshot.path,
  `v2:text:${metadataSnapshot.size}:${metadataSnapshot.mtime}:${metadataHex}`
);
let metadataInfoCalls = 0;
let metadataReadCalls = 0;
let metadataBuildCalls = 0;
const metadataNoOpEngine = new LightweightSyncEngine({
  getSettings: () => settings,
  updateRemoteInspection: async () => {},
  updateLocalQueue: async () => {},
  getLocalStore: () => metadataNoOpStore,
  readLocalFileInfo: async () => {
    metadataInfoCalls += 1;
    return {
      path: metadataSnapshot.path,
      ctime: metadataSnapshot.ctime,
      mtime: metadataSnapshot.mtime,
      size: metadataSnapshot.size,
      contentType: "text"
    };
  },
  readLocalFileSnapshot: async () => {
    metadataReadCalls += 1;
    throw new Error("Metadata no-op push should not read local content.");
  },
  buildLocalPushBundle: async () => {
    metadataBuildCalls += 1;
    throw new Error("Metadata no-op push should not build a bundle.");
  },
  applyPulledChanges: async () => ({ applied: 0, deleted: 0, skipped: 0, waiting: 0, merged: 0, backedUp: 0, conflicted: 0, failed: 0 }),
  createRemoteClient: () => ({
    ...fakeClient,
    async getChangesSince() {
      return { lastSeq: "0", changes: [] };
    },
    async putLiveSyncBundle() {
      throw new Error("Metadata no-op push should not write to CouchDB.");
    },
    async putLiveSyncBundles() {
      throw new Error("Metadata no-op push should not write to CouchDB.");
    }
  }),
  log: () => {}
});
const metadataNoOpOutcome = await metadataNoOpEngine.sync("vault-change");
assert.equal(metadataNoOpOutcome.ok, true);
assert.equal(metadataInfoCalls, 1);
assert.equal(metadataReadCalls, 0);
assert.equal(metadataBuildCalls, 0);
assert.equal(metadataNoOpOutcome.metrics.skippedFiles, 1);
assert.equal(metadataNoOpOutcome.metrics.pushedFiles, 0);
assert.equal(metadataNoOpOutcome.metrics.localBytesRead, 0);

const deletePushStore = new MemoryStore([
  { path: "notes/remove-me.md", deleted: true, queuedAt: 1, updatedAt: 1, attempts: 0, nextAttemptAt: 0, lastError: "" }
]);
await deletePushStore.setLocalPushFingerprint("notes/remove-me.md", "text:20:previous");
const deletedIds = [];
let deleteReadCalls = 0;
let deleteBuildCalls = 0;
let deletePutCalls = 0;
const deletePushEngine = new LightweightSyncEngine({
  getSettings: () => ({
    ...settings,
    usePathObfuscation: false,
    maxPushChangesPerSync: 10
  }),
  updateRemoteInspection: async () => {},
  updateLocalQueue: async () => {},
  getLocalStore: () => deletePushStore,
  readLocalFileSnapshot: async () => {
    deleteReadCalls += 1;
    throw new Error("Deleted file pushes should not read local content.");
  },
  buildLocalPushBundle: async () => {
    deleteBuildCalls += 1;
    throw new Error("Deleted file pushes should not build upload bundles.");
  },
  applyPulledChanges: async () => ({ applied: 0, deleted: 0, skipped: 0, waiting: 0, merged: 0, backedUp: 0, conflicted: 0, failed: 0 }),
  createRemoteClient: () => ({
    ...fakeClient,
    async getChangesSince() {
      return { lastSeq: "0", changes: [] };
    },
    async deleteLiveSyncDocument(id) {
      deletedIds.push(id);
      return true;
    },
    async putLiveSyncBundle() {
      deletePutCalls += 1;
      throw new Error("Deleted file pushes should not write a file bundle.");
    },
    async putLiveSyncBundles() {
      deletePutCalls += 1;
      throw new Error("Deleted file pushes should not write grouped file bundles.");
    }
  }),
  log: () => {}
});
const deletePushOutcome = await deletePushEngine.sync("vault-change");
assert.equal(deletePushOutcome.ok, true);
assert.deepEqual(deletedIds, ["notes/remove-me.md"]);
assert.equal(deletePushStore.pendingPushes.length, 0);
assert.equal(await deletePushStore.getLocalPushFingerprint("notes/remove-me.md"), "");
assert.equal(deleteReadCalls, 0);
assert.equal(deleteBuildCalls, 0);
assert.equal(deletePutCalls, 0);
assert.equal(deletePushOutcome.metrics.deletedFiles, 1);
assert.equal(deletePushOutcome.metrics.pushedFiles, 0);

const applyBacklogStore = new MemoryStore([]);
applyBacklogStore.pendingApply = 3;
let applyBacklogCalls = 0;
const applyBacklogEngine = new LightweightSyncEngine({
  getSettings: () => settings,
  updateRemoteInspection: async () => {},
  updateLocalQueue: async () => {},
  getLocalStore: () => applyBacklogStore,
  readLocalFileSnapshot: async () => undefined,
  buildLocalPushBundle: async () => {
    throw new Error("Apply-only sync should not build a local bundle.");
  },
  applyPulledChanges: async () => {
    applyBacklogCalls += 1;
    applyBacklogStore.pendingApply = Math.max(0, applyBacklogStore.pendingApply - 1);
    return { applied: 0, deleted: 0, skipped: 1, waiting: 0, merged: 0, backedUp: 0, conflicted: 0, failed: 0 };
  },
  createRemoteClient: () => ({
    ...fakeClient,
    async getChangesSince() {
      return { lastSeq: "0", changes: [] };
    }
  }),
  log: () => {}
});
const applyBacklogOutcome = await applyBacklogEngine.sync("startup");
assert.equal(applyBacklogOutcome.ok, true);
assert.equal(applyBacklogCalls, 1);
assert.equal(applyBacklogOutcome.continueSync, true);
assert.equal(applyBacklogOutcome.message.includes("More sync work remains"), true);

const applyRepairUploadStore = new MemoryStore([]);
let applyRepairUploadCalls = 0;
const applyRepairUploadEngine = new LightweightSyncEngine({
  getSettings: () => settings,
  updateRemoteInspection: async () => {},
  updateLocalQueue: async () => {},
  getLocalStore: () => applyRepairUploadStore,
  readLocalFileSnapshot: async () => undefined,
  buildLocalPushBundle: async () => {
    throw new Error("Repair upload should be queued for the next pass, not built in the apply pass.");
  },
  applyPulledChanges: async () => {
    applyRepairUploadCalls += 1;
    applyRepairUploadStore.pendingApply = 0;
    await applyRepairUploadStore.queueLocalChanges([{ path: ".obsidian/plugins/ai-helper/data.json", deleted: false }]);
    return { applied: 0, deleted: 0, skipped: 0, waiting: 0, merged: 1, backedUp: 1, conflicted: 0, failed: 0 };
  },
  createRemoteClient: () => ({
    ...fakeClient,
    async getChangesSince() {
      return {
        lastSeq: "repair-seq",
        changes: [
          {
            id: ".obsidian/plugins/ai-helper/data.json",
            seq: "repair-seq",
            doc: { _id: ".obsidian/plugins/ai-helper/data.json", _rev: "1-r", type: "plain", path: ".obsidian/plugins/ai-helper/data.json", children: [], mtime: 1, ctime: 1, size: 0 }
          }
        ]
      };
    }
  }),
  log: () => {}
});
const applyRepairUploadOutcome = await applyRepairUploadEngine.sync("startup");
assert.equal(applyRepairUploadOutcome.ok, true);
assert.equal(applyRepairUploadCalls, 1);
assert.equal(applyRepairUploadOutcome.continueSync, true);
assert.equal((await applyRepairUploadStore.getSummary()).pendingPush, 1);
assert.match(applyRepairUploadOutcome.message, /Still waiting locally: 1 upload/);
assert.match(applyRepairUploadOutcome.message, /More sync work remains/);

const waitingBacklogStore = new MemoryStore([]);
waitingBacklogStore.pendingApply = 3;
const waitingBacklogEngine = new LightweightSyncEngine({
  getSettings: () => settings,
  updateRemoteInspection: async () => {},
  updateLocalQueue: async () => {},
  getLocalStore: () => waitingBacklogStore,
  readLocalFileSnapshot: async () => undefined,
  buildLocalPushBundle: async () => {
    throw new Error("Waiting apply sync should not build a local bundle.");
  },
  applyPulledChanges: async () => ({ applied: 0, deleted: 0, skipped: 0, waiting: 3, merged: 0, backedUp: 0, conflicted: 0, failed: 0 }),
  createRemoteClient: () => ({
    ...fakeClient,
    async getChangesSince() {
      return { lastSeq: "0", changes: [] };
    }
  }),
  log: () => {}
});
const waitingBacklogOutcome = await waitingBacklogEngine.sync("startup");
assert.equal(waitingBacklogOutcome.ok, true);
assert.equal(waitingBacklogOutcome.continueSync, false);

class PullBatchStore extends MemoryStore {
  constructor() {
    super([]);
    this.cacheBatchSizes = [];
    this.cacheOnlyBatchSizes = [];
  }

  async cacheRemoteChangesOnly(changes) {
    this.cacheOnlyBatchSizes.push(changes.length);
    if (changes.length > 0) {
      this.lastRemoteSeq = String(changes.at(-1).seq);
      this.pendingApply += changes.length;
    }
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
assert.deepEqual(pullBatchStore.cacheOnlyBatchSizes, [50]);
assert.deepEqual(pullBatchStore.cacheBatchSizes, [10]);
assert.equal(pullBatchYields, 4);
assert.equal(pullBatchOutcome.metrics.pulledChanges, 60);
assert.equal((await pullBatchStore.getSummary()).pendingApply, 60);

class PullCheckpointStore extends MemoryStore {
  constructor() {
    super([]);
    this.checkpoints = [];
  }

  async cacheRemoteChanges(changes) {
    if (changes.length > 0) {
      this.lastRemoteSeq = String(changes.at(-1).seq);
      this.pendingApply += changes.length;
    }
    return this.getSummary();
  }

  async setCheckpoint(lastSeq) {
    this.checkpoints.push(String(lastSeq));
    this.lastRemoteSeq = String(lastSeq);
  }
}

const pullCheckpointStore = new PullCheckpointStore();
const pullCheckpointEngine = new LightweightSyncEngine({
  getSettings: () => ({
    ...settings,
    autoApplyPull: false,
    maxPushChangesPerSync: 1
  }),
  updateRemoteInspection: async () => {},
  updateLocalQueue: async () => {},
  getLocalStore: () => pullCheckpointStore,
  readLocalFileSnapshot: async () => undefined,
  buildLocalPushBundle: async () => {
    throw new Error("Checkpoint-only pull must not build a local bundle.");
  },
  applyPulledChanges: async () => {
    throw new Error("Auto apply is disabled for this checkpoint check.");
  },
  createRemoteClient: () => ({
    ...fakeClient,
    async getChangesSince(since) {
      assert.equal(since, "0");
      return {
        lastSeq: "server-checkpoint-after-window",
        changes: [
          { id: "remote-checkpoint.md", seq: "document-seq", doc: { _id: "remote-checkpoint.md", _rev: "1-a", type: "plain", path: "remote-checkpoint.md", children: [], mtime: 1, ctime: 1, size: 0 } }
        ]
      };
    }
  }),
  log: () => {}
});
const pullCheckpointOutcome = await pullCheckpointEngine.sync("periodic");
assert.equal(pullCheckpointOutcome.ok, true);
assert.equal((await pullCheckpointStore.getSummary()).lastRemoteSeq, "server-checkpoint-after-window");
assert.deepEqual(pullCheckpointStore.checkpoints, ["server-checkpoint-after-window"]);

const fullRemotePageStore = new PullBatchStore();
const fullRemotePageChanges = Array.from({ length: 250 }, (_, index) => {
  const seq = String(index + 1);
  return {
    id: `remote-page-${seq}.md`,
    seq,
    doc: { _id: `remote-page-${seq}.md`, _rev: `1-${seq}`, type: "plain", path: `remote-page-${seq}.md`, children: [], mtime: 1, ctime: 1, size: 0 }
  };
});
const fullRemotePageEngine = new LightweightSyncEngine({
  getSettings: () => ({
    ...settings,
    autoApplyPull: false
  }),
  updateRemoteInspection: async () => {},
  updateLocalQueue: async () => {},
  getLocalStore: () => fullRemotePageStore,
  readLocalFileSnapshot: async () => undefined,
  buildLocalPushBundle: async () => {
    throw new Error("Remote-page wording check should not build local bundles.");
  },
  applyPulledChanges: async () => {
    throw new Error("Auto apply is disabled for this remote-page wording check.");
  },
  createRemoteClient: () => ({
    ...fakeClient,
    async inspect() {
      return {
        ...await fakeClient.inspect(),
        updateSequence: "remote-end-after-this-page"
      };
    },
    async getChangesSince() {
      return { lastSeq: "250", changes: fullRemotePageChanges };
    }
  }),
  log: () => {}
});
const fullRemotePageOutcome = await fullRemotePageEngine.sync("manual");
assert.equal(fullRemotePageOutcome.ok, true);
assert.equal(fullRemotePageOutcome.continueSync, true);
assert.match(fullRemotePageOutcome.message, /Still waiting locally: 0 uploads, 250 remote apply items/);
assert.match(fullRemotePageOutcome.message, /Remote catch-up is still paging through CouchDB/);

const lightweightPeriodicStore = new MemoryStore([]);
let lightweightPeriodicInspectCalls = 0;
let lightweightPeriodicPullSince = "";
const lightweightPeriodicEngine = new LightweightSyncEngine({
  getSettings: () => settings,
  updateRemoteInspection: async () => {
    throw new Error("Lightweight periodic pulls should not refresh remote inspection.");
  },
  updateLocalQueue: async () => {},
  getLocalStore: () => lightweightPeriodicStore,
  readLocalFileSnapshot: async () => {
    throw new Error("Pull-only periodic sync should not read local files.");
  },
  buildLocalPushBundle: async () => {
    throw new Error("Pull-only periodic sync should not build upload bundles.");
  },
  applyPulledChanges: async () => ({ applied: 0, deleted: 0, skipped: 0, waiting: 0, merged: 0, backedUp: 0, conflicted: 0, failed: 0 }),
  createRemoteClient: () => ({
    ...fakeClient,
    async inspect() {
      lightweightPeriodicInspectCalls += 1;
      throw new Error("Lightweight periodic pulls should use the cached setup instead of inspection.");
    },
    async getChangesSince(since) {
      lightweightPeriodicPullSince = String(since);
      return { lastSeq: "42", changes: [] };
    }
  }),
  log: () => {}
});
const lightweightPeriodicOutcome = await lightweightPeriodicEngine.sync("periodic");
assert.equal(lightweightPeriodicOutcome.ok, true);
assert.equal(lightweightPeriodicInspectCalls, 0);
assert.equal(lightweightPeriodicPullSince, "0");
assert.equal((await lightweightPeriodicStore.getSummary()).lastRemoteSeq, "42");
assert.equal(lightweightPeriodicOutcome.metrics.inspectMs, 0);
assert.equal(lightweightPeriodicOutcome.metrics.pulledChanges, 0);

const quietPeriodicStore = new MemoryStore([]);
quietPeriodicStore.lastRemoteSeq = "quiet-checkpoint";
let quietPeriodicSummaryReads = 0;
const quietPeriodicEngine = new LightweightSyncEngine({
  getSettings: () => ({
    ...settings,
    remoteState: {
      ...settings.remoteState,
      syncParameterSalt: "salted"
    }
  }),
  updateRemoteInspection: async () => {},
  updateLocalQueue: async () => {},
  getLocalStore: () => quietPeriodicStore,
  readLocalFileSnapshot: async () => undefined,
  buildLocalPushBundle: async () => {
    throw new Error("Quiet periodic sync should not build a local bundle.");
  },
  applyPulledChanges: async () => {
    throw new Error("Quiet periodic sync should not apply files.");
  },
  createRemoteClient: () => ({
    ...fakeClient,
    async inspect() {
      throw new Error("Quiet periodic sync should skip full inspection.");
    },
    async getChangesSince(since) {
      assert.equal(since, "quiet-checkpoint");
      return { lastSeq: "quiet-checkpoint", changes: [] };
    }
  }),
  log: () => {}
});
const originalQuietSummary = quietPeriodicStore.getSummary.bind(quietPeriodicStore);
quietPeriodicStore.getSummary = async () => {
  quietPeriodicSummaryReads += 1;
  return originalQuietSummary();
};
const quietPeriodicOutcome = await quietPeriodicEngine.sync("periodic");
assert.equal(quietPeriodicOutcome.ok, true);
assert.equal(quietPeriodicSummaryReads, 1);
assert.equal(quietPeriodicOutcome.metrics.pulledChanges, 0);

const missingSaltStore = new MemoryStore([]);
let missingSaltInspectCalls = 0;
let missingSaltInspectionSampled = false;
const missingSaltEngine = new LightweightSyncEngine({
  getSettings: () => ({
    ...settings,
    remoteState: {
      ...settings.remoteState,
      syncParameterSalt: ""
    }
  }),
  updateRemoteInspection: async () => {},
  updateLocalQueue: async () => {},
  getLocalStore: () => missingSaltStore,
  readLocalFileSnapshot: async () => undefined,
  buildLocalPushBundle: async () => {
    throw new Error("Missing-salt inspection check should not build local bundles.");
  },
  applyPulledChanges: async () => ({ applied: 0, deleted: 0, skipped: 0, waiting: 0, merged: 0, backedUp: 0, conflicted: 0, failed: 0 }),
  createRemoteClient: () => ({
    ...fakeClient,
    async inspect(options = {}) {
      missingSaltInspectCalls += 1;
      missingSaltInspectionSampled = options.includeRecentChangesSample === true;
      return fakeClient.inspect();
    },
    async getChangesSince() {
      return { lastSeq: "0", changes: [] };
    }
  }),
  log: () => {}
});
const missingSaltOutcome = await missingSaltEngine.sync("periodic");
assert.equal(missingSaltOutcome.ok, true);
assert.equal(missingSaltInspectCalls, 1);
assert.equal(missingSaltInspectionSampled, false);

const startupCatchUpStore = new MemoryStore([]);
startupCatchUpStore.lastRemoteSeq = "9039-g1AAAAC";
let startupCatchUpInspectCalls = 0;
let startupCatchUpPullSince = "";
const startupCatchUpEngine = new LightweightSyncEngine({
  getSettings: () => settings,
  updateRemoteInspection: async () => {
    throw new Error("Startup catch-up with an existing checkpoint should not refresh remote inspection.");
  },
  updateLocalQueue: async () => {},
  getLocalStore: () => startupCatchUpStore,
  readLocalFileSnapshot: async () => {
    throw new Error("Pull-only startup catch-up should not read local files.");
  },
  buildLocalPushBundle: async () => {
    throw new Error("Pull-only startup catch-up should not build upload bundles.");
  },
  applyPulledChanges: async () => ({ applied: 0, deleted: 0, skipped: 0, waiting: 0, merged: 0, backedUp: 0, conflicted: 0, failed: 0 }),
  createRemoteClient: () => ({
    ...fakeClient,
    async inspect() {
      startupCatchUpInspectCalls += 1;
      throw new Error("Startup catch-up should use the saved checkpoint instead of inspection.");
    },
    async getChangesSince(since) {
      startupCatchUpPullSince = String(since);
      return { lastSeq: "9316-g1AAAAC", changes: [] };
    }
  }),
  log: () => {}
});
const startupCatchUpOutcome = await startupCatchUpEngine.sync("startup");
assert.equal(startupCatchUpOutcome.ok, true);
assert.equal(startupCatchUpInspectCalls, 0);
assert.equal(startupCatchUpPullSince, "9039-g1AAAAC");
assert.equal((await startupCatchUpStore.getSummary()).lastRemoteSeq, "9316-g1AAAAC");

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
  applyPulledChanges: async () => ({ applied: 0, deleted: 0, skipped: 0, waiting: 0, merged: 0, backedUp: 0, conflicted: 0, failed: 0 }),
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
  applyPulledChanges: async () => ({ applied: 0, deleted: 0, skipped: 0, waiting: 0, merged: 0, backedUp: 0, conflicted: 0, failed: 0 }),
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
  retryDidNotBlockDuePush: retryPutCalls[0].bundles[0].fileDocument._id,
  noOpSkippedWithoutNetworkWrite: noOpOutcome.metrics.skippedFiles,
  deletePushIds: deletedIds,
  automaticFirstSyncQueued: automaticFirstQueued,
  automaticFirstSyncPulledOwnUpload: automaticFirstPulled,
  progressPhases: [...new Set(progressEvents.map((event) => event.phase))],
  pullCacheBatchSizes: pullBatchStore.cacheBatchSizes,
  pullCacheYields: pullBatchYields,
  lightweightPeriodicSkippedInspect: lightweightPeriodicInspectCalls === 0,
  quietPeriodicSummaryReads,
  missingSaltStillInspects: missingSaltInspectCalls === 1,
  startupCatchUpSkippedInspect: startupCatchUpInspectCalls === 0,
  offlineAutomatic: offlineAutomatic.message,
  offlineManualTriedNetwork: offlineClientCalls === 1,
  additionalDeviceInitialise: additionalDeviceInitialise.message,
  message: outcome.message
}, null, 2));
