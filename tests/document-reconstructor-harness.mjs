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

console.log(JSON.stringify({ ok: true, eden: true, binary: true, reconstructionYields }, null, 2));
