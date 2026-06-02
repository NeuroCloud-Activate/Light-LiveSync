import assert from "node:assert/strict";
import { cachedRemoteDocumentFromChange } from "../src/local-document-store.ts";

const fileDoc = {
  _id: "remote-note",
  _rev: "2-current",
  type: "plain",
  path: "Notes/remote.md",
  children: [],
  mtime: 1,
  ctime: 1,
  size: 0
};

const previousApplied = {
  id: "remote-note",
  rev: "2-current",
  seq: "10",
  pulledAt: 100,
  stagedAt: 200,
  appliedAt: 300,
  deleted: false,
  kind: "file",
  doc: fileDoc
};

const replayed = cachedRemoteDocumentFromChange(
  { id: "remote-note", seq: "11", doc: fileDoc },
  previousApplied,
  400
);
assert.equal(replayed.appliedAt, 300);
assert.equal(replayed.stagedAt, 200);
assert.equal(replayed.seq, "11");

const changedRevision = cachedRemoteDocumentFromChange(
  {
    id: "remote-note",
    seq: "12",
    doc: {
      ...fileDoc,
      _rev: "3-new"
    }
  },
  previousApplied,
  500
);
assert.equal(changedRevision.appliedAt, 0);
assert.equal(changedRevision.stagedAt, 0);

const objectSequence = cachedRemoteDocumentFromChange(
  {
    id: "remote-note",
    seq: { sequence: "opaque-mobile-token" },
    doc: fileDoc
  },
  undefined,
  600
);
assert.equal(objectSequence.seq, "{\"sequence\":\"opaque-mobile-token\"}");

console.log(JSON.stringify({
  ok: true,
  replayPreservedApplyState: replayed.appliedAt === 300,
  changedRevisionQueued: changedRevision.appliedAt === 0,
  opaqueSequenceStored: objectSequence.seq
}, null, 2));
