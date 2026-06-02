import assert from "node:assert/strict";
import { LightweightSyncEngine } from "../src/sync-engine.ts";
import { DEFAULT_SETTINGS } from "../src/settings.ts";

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function textFingerprint(path, content) {
  const encoded = new TextEncoder().encode(content);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoded);
  return {
    path,
    content,
    size: encoded.byteLength,
    fingerprint: `text:${encoded.byteLength}:${bytesToHex(new Uint8Array(digest))}`
  };
}

class StressStore {
  constructor(pendingPushes) {
    this.pendingPushes = pendingPushes;
    this.lastRemoteSeq = "0";
    this.pendingApply = 0;
    this.fingerprints = new Map();
  }

  async getPendingLocalPushBatch(limit) {
    const now = Date.now();
    return this.pendingPushes
      .filter((change) => (change.nextAttemptAt ?? 0) <= now)
      .sort((left, right) => left.queuedAt - right.queuedAt)
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

  async getCheckpoint() {
    return { lastRemoteSeq: this.lastRemoteSeq, updatedAt: 0 };
  }

  async cacheRemoteChanges(changes) {
    if (changes.length > 0) {
      this.lastRemoteSeq = String(changes.at(-1).seq);
      this.pendingApply += changes.filter((change) => change.doc?.type === "plain" || change.deleted).length;
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

const uniqueNotes = await Promise.all(
  Array.from({ length: 24 }, (_, index) => {
    const noteNumber = String(index + 1).padStart(2, "0");
    return textFingerprint(
      `stress/note-${noteNumber}.md`,
      [
        `# Stress note ${noteNumber}`,
        "This note represents many edits coalesced into one queued push.",
        `Final edit version ${index + 4}.`
      ].join("\n")
    );
  })
);
const noOpNotes = await Promise.all(
  Array.from({ length: 6 }, (_, index) => {
    const noteNumber = String(index + 1).padStart(2, "0");
    return textFingerprint(`stress/noop-${noteNumber}.md`, `Already uploaded note ${noteNumber}.`);
  })
);
const allSnapshots = new Map([...uniqueNotes, ...noOpNotes].map((snapshot) => [snapshot.path, snapshot]));
const pendingPushes = [...uniqueNotes, ...noOpNotes].map((snapshot, index) => ({
  path: snapshot.path,
  deleted: false,
  queuedAt: index + 1,
  updatedAt: index + 100,
  attempts: 0,
  nextAttemptAt: 0,
  lastError: ""
}));
const store = new StressStore(pendingPushes);
for (const note of noOpNotes) {
  await store.setLocalPushFingerprint(note.path, note.fingerprint);
}

const settings = {
  ...DEFAULT_SETTINGS,
  configured: true,
  couchDb: {
    ...DEFAULT_SETTINGS.couchDb,
    uri: "http://example.com:5984",
    database: "stress",
    username: "user",
    password: "password"
  },
  passphrase: "vault-passphrase",
  remoteState: {
    ...DEFAULT_SETTINGS.remoteState,
    syncParameterSalt: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
  },
  maxPushChangesPerSync: 5,
  autoApplyPull: true
};

let cycle = 0;
const putCalls = [];
const cycleMetrics = [];
let applyCalls = 0;
let maxPutCallsInCycle = 0;
let currentCyclePutCalls = 0;

const remoteChanges = [
  { id: "remote-a.md", seq: "1", doc: { _id: "remote-a.md", _rev: "1-a", type: "plain", path: "remote-a.md", children: [], mtime: 1, ctime: 1, size: 10 } },
  { id: "remote-b.md", seq: "2", doc: { _id: "remote-b.md", _rev: "1-b", type: "plain", path: "remote-b.md", children: [], mtime: 1, ctime: 1, size: 10 } },
  { id: "remote-c.md", seq: "3", doc: { _id: "remote-c.md", _rev: "1-c", type: "plain", path: "remote-c.md", children: [], mtime: 1, ctime: 1, size: 10 } }
];

const fakeClient = {
  async ensureDatabase() {
    return { created: false, info: { db_name: "stress", doc_count: 1, update_seq: "1" } };
  },
  async ensureSyncParameters() {
    return { created: false, parameters: {} };
  },
  async inspect() {
    return {
      serverVersion: "test",
      databaseName: "stress",
      documentCount: 1 + remoteChanges.length,
      updateSequence: String(cycle),
      syncParametersPresent: true,
      syncParameterSalt: settings.remoteState.syncParameterSalt,
      milestonePresent: false,
      sample: { total: remoteChanges.length, notes: remoteChanges.length, chunks: 0, system: 0, deleted: 0, unknown: 0 }
    };
  },
  async getChangesSince() {
    const change = remoteChanges[cycle - 1];
    return change ? { lastSeq: change.seq, changes: [change] } : { lastSeq: String(cycle), changes: [] };
  },
  async deleteLiveSyncDocument() {
    return true;
  },
  async putLiveSyncBundle(fileDocument, chunkDocuments) {
    currentCyclePutCalls += 1;
    putCalls.push({ fileDocument, chunkDocuments });
    return { fileId: fileDocument._id, written: 1 + chunkDocuments.length, reused: 0, conflicts: 0 };
  }
};

const engine = new LightweightSyncEngine({
  getSettings: () => settings,
  updateRemoteInspection: async () => {},
  updateLocalQueue: async () => {},
  getLocalStore: () => store,
  readLocalFileSnapshot: async (path) => {
    const snapshot = allSnapshots.get(path);
    return {
      path,
      content: snapshot.content,
      ctime: 1,
      mtime: 2,
      size: snapshot.size
    };
  },
  buildLocalPushBundle: async (snapshot) => ({
    fileDocument: { _id: snapshot.path, type: "plain", path: snapshot.path, children: [`h:${snapshot.path}`], ctime: 1, mtime: 2, size: snapshot.size },
    chunkDocuments: [{ _id: `h:${snapshot.path}`, type: "leaf", data: typeof snapshot.content === "string" ? snapshot.content : "" }]
  }),
  applyPulledChanges: async () => {
    applyCalls += 1;
    const applied = store.pendingApply;
    store.pendingApply = 0;
    return { applied, deleted: 0, skipped: 0, merged: 0, backedUp: applied, conflicted: 0, failed: 0 };
  },
  createRemoteClient: () => fakeClient,
  log: () => {}
});

while ((await store.getSummary()).pendingPush > 0) {
  cycle += 1;
  currentCyclePutCalls = 0;
  const outcome = await engine.sync("vault-change");
  assert.equal(outcome.ok, true);
  assert.ok(outcome.metrics.pushedFiles + outcome.metrics.skippedFiles <= settings.maxPushChangesPerSync);
  assert.ok(currentCyclePutCalls <= settings.maxPushChangesPerSync);
  maxPutCallsInCycle = Math.max(maxPutCallsInCycle, currentCyclePutCalls);
  cycleMetrics.push(outcome.metrics);
}

const finalSummary = await store.getSummary();
const totalPushed = cycleMetrics.reduce((sum, metrics) => sum + metrics.pushedFiles, 0);
const totalSkipped = cycleMetrics.reduce((sum, metrics) => sum + metrics.skippedFiles, 0);
const totalRemoteDocsWritten = cycleMetrics.reduce((sum, metrics) => sum + metrics.remoteDocsWritten, 0);
const totalPulled = cycleMetrics.reduce((sum, metrics) => sum + metrics.pulledChanges, 0);

assert.equal(finalSummary.pendingPush, 0);
assert.equal(finalSummary.pendingApply, 0);
assert.equal(totalPushed, uniqueNotes.length);
assert.equal(totalSkipped, noOpNotes.length);
assert.equal(putCalls.length, uniqueNotes.length);
assert.equal(totalPulled, remoteChanges.length);
assert.equal(applyCalls, remoteChanges.length);
assert.ok(cycle > 1);
assert.equal(maxPutCallsInCycle, settings.maxPushChangesPerSync);
assert.equal(totalRemoteDocsWritten, uniqueNotes.length * 2);

console.log(JSON.stringify({
  ok: true,
  cycles: cycle,
  uniqueNotes: uniqueNotes.length,
  noOpNotes: noOpNotes.length,
  totalPushed,
  totalSkipped,
  putCalls: putCalls.length,
  maxPutCallsInCycle,
  totalRemoteDocsWritten,
  totalPulled,
  applyCalls,
  pendingPush: finalSummary.pendingPush,
  pendingApply: finalSummary.pendingApply
}, null, 2));
