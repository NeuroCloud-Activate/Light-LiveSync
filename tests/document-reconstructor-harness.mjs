#!/usr/bin/env node

import assert from "node:assert/strict";
import { DocumentReconstructor } from "../src/document-reconstructor.ts";

class MemoryStore {
  constructor(chunks = {}, pending = []) {
    this.chunks = new Map(Object.entries(chunks));
    this.pending = pending;
  }

  async getPendingApplyBatch(limit) {
    return this.pending.slice(0, limit);
  }

  async getPendingStagingBatch() {
    return [];
  }

  async getCachedDocuments(ids) {
    return new Map(ids.map((id) => [id, this.chunks.get(id)]).filter((entry) => entry[1]));
  }

  async cacheRemoteDocuments(docs) {
    for (const doc of docs) {
      this.chunks.set(doc._id, chunk(doc._id, doc.data));
    }
  }
}

const options = {
  passphrase: "",
  syncParameterSalt: "",
  useDynamicIterationCount: false,
  e2eeAlgorithm: "v2"
};

function cached(doc) {
  return {
    id: doc._id,
    rev: doc._rev ?? "1-local",
    seq: "1",
    pulledAt: 0,
    stagedAt: 0,
    appliedAt: 0,
    deleted: false,
    kind: "file",
    doc
  };
}

function chunk(id, data) {
  return {
    id,
    rev: "1-chunk",
    seq: "1",
    pulledAt: 0,
    stagedAt: 0,
    appliedAt: 0,
    deleted: false,
    kind: "chunk",
    doc: { _id: id, type: "leaf", data }
  };
}

const textReconstructor = new DocumentReconstructor(
  new MemoryStore({
    "h:a": chunk("h:a", "hello "),
    "h:b": chunk("h:b", "world")
  }),
  options
);
const textPreview = await textReconstructor.preview(
  cached({
    _id: "notes/a.md",
    path: "notes/a.md",
    type: "plain",
    children: ["h:a", "h:b"],
    ctime: 1,
    mtime: 2,
    size: 11,
    eden: {}
  })
);

assert.equal(textPreview.status, "ready");
assert.equal(textPreview.contentType, "text");
assert.equal(textPreview.content, "hello world");

const edenPreview = await new DocumentReconstructor(new MemoryStore(), options).preview(
  cached({
    _id: "notes/eden.md",
    path: "notes/eden.md",
    type: "plain",
    children: ["h:eden"],
    ctime: 1,
    mtime: 2,
    size: 4,
    eden: {
      "h:eden": { data: "eden" }
    }
  })
);

assert.equal(edenPreview.status, "ready");
assert.equal(edenPreview.content, "eden");

const binaryPreview = await new DocumentReconstructor(
  new MemoryStore({
    "h:bin": chunk("h:bin", "AQIDBA==")
  }),
  options
).preview(
  cached({
    _id: "assets/a.bin",
    path: "assets/a.bin",
    type: "newnote",
    children: ["h:bin"],
    ctime: 1,
    mtime: 2,
    size: 4,
    eden: {}
  })
);

assert.equal(binaryPreview.status, "ready");
assert.equal(binaryPreview.contentType, "binary");
assert.deepEqual([...new Uint8Array(binaryPreview.content)], [1, 2, 3, 4]);

const urlSafeBinaryPreview = await new DocumentReconstructor(
  new MemoryStore({
    "h:urlsafe": chunk("h:urlsafe", "-_8")
  }),
  options
).preview(
  cached({
    _id: "assets/url-safe.bin",
    path: "assets/url-safe.bin",
    type: "newnote",
    children: ["h:urlsafe"],
    ctime: 1,
    mtime: 2,
    size: 2,
    eden: {}
  })
);

assert.equal(urlSafeBinaryPreview.status, "ready");
assert.deepEqual([...new Uint8Array(urlSafeBinaryPreview.content)], [251, 255]);

const corruptBinaryPreview = await new DocumentReconstructor(
  new MemoryStore({
    "h:bad-bin": chunk("h:bad-bin", "not valid base64?")
  }),
  options
).preview(
  cached({
    _id: "assets/bad.bin",
    path: "assets/bad.bin",
    type: "newnote",
    children: ["h:bad-bin"],
    ctime: 1,
    mtime: 2,
    size: 99,
    eden: {}
  })
);

assert.equal(corruptBinaryPreview.status, "unsupported");
assert.match(corruptBinaryPreview.reason, /base64/);

let missingChunkRepairCalls = 0;
const repairedPreview = await new DocumentReconstructor(
  new MemoryStore(),
  options,
  {
    loadMissingChunks: async (ids) => {
      missingChunkRepairCalls += 1;
      return new Map(ids.map((id) => [id, { _id: id, type: "leaf", data: id.endsWith("a") ? "fixed " : "chunks" }]));
    }
  }
).preview(
  cached({
    _id: "notes/repaired.md",
    path: "notes/repaired.md",
    type: "plain",
    children: ["h:repair-a", "h:repair-b"],
    ctime: 1,
    mtime: 2,
    size: 12,
    eden: {}
  })
);

assert.equal(repairedPreview.status, "ready");
assert.equal(repairedPreview.content, "fixed chunks");
assert.equal(missingChunkRepairCalls, 1);

const stillMissingPreview = await new DocumentReconstructor(
  new MemoryStore(),
  options,
  {
    loadMissingChunks: async () => new Map()
  }
).preview(
  cached({
    _id: "notes/missing.md",
    path: "notes/missing.md",
    type: "plain",
    children: ["h:missing"],
    ctime: 1,
    mtime: 2,
    size: 7,
    eden: {}
  })
);

assert.equal(stillMissingPreview.status, "missing-chunks");
assert.deepEqual(stillMissingPreview.missingChunkIds, ["h:missing"]);

const batchMissingStore = new MemoryStore({}, [
  cached({
    _id: "notes/batch-a.md",
    path: "notes/batch-a.md",
    type: "plain",
    children: ["h:batch-a"],
    ctime: 1,
    mtime: 2,
    size: 1,
    eden: {}
  }),
  cached({
    _id: "notes/batch-b.md",
    path: "notes/batch-b.md",
    type: "plain",
    children: ["h:batch-b"],
    ctime: 1,
    mtime: 2,
    size: 1,
    eden: {}
  })
]);
const batchMissingCalls = [];
const batchMissingSummary = await new DocumentReconstructor(
  batchMissingStore,
  options,
  {
    loadMissingChunks: async (ids) => {
      batchMissingCalls.push(ids);
      const repaired = ids.map((id) => ({ _id: id, type: "leaf", data: id.endsWith("a") ? "A" : "B" }));
      await batchMissingStore.cacheRemoteDocuments(repaired);
      return new Map(repaired.map((doc) => [doc._id, doc]));
    }
  }
).previewPending(10);

assert.equal(batchMissingSummary.ready, 2);
assert.equal(batchMissingCalls.length, 1);
assert.deepEqual(batchMissingCalls[0].sort(), ["h:batch-a", "h:batch-b"]);

let reconstructionYields = 0;
const chunkIds = Array.from({ length: 9 }, (_, index) => `h:large-${index}`);
const largeChunks = Object.fromEntries(chunkIds.map((id, index) => [id, chunk(id, `${index}`)]));
const largeDoc = cached({
  _id: "notes/large.md",
  path: "notes/large.md",
  type: "plain",
  children: chunkIds,
  ctime: 1,
  mtime: 2,
  size: 9,
  eden: {}
});
const yieldingPreview = await new DocumentReconstructor(
  new MemoryStore(largeChunks, [largeDoc]),
  options,
  {
    yieldEveryChunks: 4,
    yieldToUi: async () => {
      reconstructionYields += 1;
    }
  }
).previewPending(1);

assert.equal(yieldingPreview.ready, 1);
assert.equal(yieldingPreview.previews[0].content, "012345678");
assert.equal(reconstructionYields, 4);

console.log(JSON.stringify({
  ok: true,
  eden: true,
  binary: true,
  urlSafeBinary: true,
  corruptBinary: corruptBinaryPreview.status,
  missingChunkRepairCalls,
  batchMissingChunkRepairCalls: batchMissingCalls.length,
  stillMissing: stillMissingPreview.status,
  reconstructionYields
}, null, 2));
