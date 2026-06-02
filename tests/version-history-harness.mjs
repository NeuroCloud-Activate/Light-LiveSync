#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  buildVersionDocument,
  listFileVersions,
  listRecentlyDeletedFileVersions,
  restoreFileVersion,
  writeVersionForFile
} from "../src/version-history.ts";

const transformOptions = {
  passphrase: "",
  syncParameterSalt: "",
  useDynamicIterationCount: false,
  e2eeAlgorithm: "v2"
};

class MemoryVersionClient {
  constructor(documents = [], chunks = []) {
    this.documents = new Map(documents.map((doc) => [doc._id, doc]));
    this.chunks = new Map(chunks.map((doc) => [doc._id, doc]));
    this.saved = [];
    this.deleted = [];
  }

  async getOptionalDocument(id) {
    return this.documents.get(id) ?? this.chunks.get(id);
  }

  async getDocumentsByIds(ids) {
    return new Map(ids.map((id) => [id, this.chunks.get(id)]).filter((entry) => entry[1]));
  }

  async getVersionDocumentsForFile(fileId) {
    return [...this.documents.values()].filter((doc) => doc.versionFor === fileId && !doc._deleted);
  }

  async getRecentVersionDocuments(limit) {
    return [...this.documents.values()]
      .filter((doc) => doc.llsVersion && !doc._deleted)
      .slice(0, limit);
  }

  async putVersionDocument(doc) {
    if (this.documents.has(doc._id)) {
      return false;
    }
    const saved = { ...doc, _rev: "1-saved" };
    this.documents.set(saved._id, saved);
    this.saved.push(saved);
    return true;
  }

  async deleteDocuments(docs) {
    for (const doc of docs) {
      this.deleted.push(doc._id);
      this.documents.delete(doc._id);
    }
    return docs.length;
  }
}

class MemoryAdapter {
  constructor(files = {}) {
    this.files = new Map(Object.entries(files));
    this.folders = new Set();
  }

  async exists(path) {
    return this.files.has(path) || this.folders.has(path);
  }

  async mkdir(path) {
    this.folders.add(path);
  }

  async read(path) {
    return this.files.get(path);
  }

  async write(path, content) {
    this.files.set(path, content);
  }

  async readBinary(path) {
    return this.files.get(path);
  }

  async writeBinary(path, content) {
    this.files.set(path, content);
  }
}

const fileDocument = {
  _id: "Notes/example.md",
  type: "plain",
  path: "Notes/example.md",
  children: ["h:a", "h:b"],
  ctime: 1,
  mtime: 2,
  size: 11,
  eden: {}
};

const now = Date.now();
const existingVersions = Array.from({ length: 12 }, (_, index) => ({
  ...buildVersionDocument(fileDocument, `text:11:${index}`, now - index * 1000),
  _rev: `1-${index}`
}));
existingVersions.push({
  ...buildVersionDocument(fileDocument, "text:11:too-old", now - 91 * 24 * 60 * 60 * 1000),
  _rev: "1-old"
});

const client = new MemoryVersionClient(existingVersions);
const writeResult = await writeVersionForFile(client, fileDocument, "text:11:new", {
  maxVersionsPerFile: 10,
  maxVersionAgeDays: 90
});
const remaining = await client.getVersionDocumentsForFile(fileDocument._id);

assert.equal(writeResult.saved, 1);
assert.equal(remaining.length, 10);
assert.equal(remaining.some((doc) => doc.versionHash === "text:11:too-old"), false);
assert.ok(client.deleted.length >= 4);

const skippedClient = new MemoryVersionClient([
  {
    ...buildVersionDocument(fileDocument, "text:11:same", now),
    _rev: "1-same"
  }
]);
const skipped = await writeVersionForFile(skippedClient, fileDocument, "text:11:same", {
  maxVersionsPerFile: 10,
  maxVersionAgeDays: 90
});

assert.equal(skipped.saved, 0);
assert.equal(skipped.skipped, 1);
assert.equal(skippedClient.saved.length, 0);

const restorableVersion = {
  ...buildVersionDocument(fileDocument, "text:11:restore", now),
  _rev: "1-restore"
};
const restoreClient = new MemoryVersionClient(
  [restorableVersion],
  [
    { _id: "h:a", type: "leaf", data: "old " },
    { _id: "h:b", type: "leaf", data: "version" }
  ]
);
const versions = await listFileVersions(restoreClient, "Notes/example.md", transformOptions, false);

assert.equal(versions.length, 1);
assert.equal(versions[0].path, "Notes/example.md");
assert.equal(versions[0].chunkCount, 2);

const adapter = new MemoryAdapter({
  "Notes/example.md": "current version"
});
const restoreResult = await restoreFileVersion(
  restoreClient,
  adapter,
  restorableVersion._id,
  transformOptions,
  ".obsidian/plugins/light-livesync/conflicts"
);

assert.equal(restoreResult.restoredPath, "Notes/example.md");
assert.equal(restoreResult.createdPreRestoreBackup, true);
assert.equal(adapter.files.get("Notes/example.md"), "old version");
assert.equal(adapter.files.get(restoreResult.preRestoreBackupPath), "current version");

const deletedVersions = await listRecentlyDeletedFileVersions(
  restoreClient,
  adapter,
  transformOptions,
  10
);

assert.equal(deletedVersions.some((entry) => entry.path === "Notes/example.md"), false);

const missingFileVersions = await listRecentlyDeletedFileVersions(
  restoreClient,
  new MemoryAdapter({}),
  transformOptions,
  10
);

assert.equal(missingFileVersions.length, 1);
assert.equal(missingFileVersions[0].path, "Notes/example.md");
assert.equal(missingFileVersions[0].versionCount, 1);

console.log(JSON.stringify({
  ok: true,
  remainingVersions: remaining.length,
  pruned: client.deleted.length,
  restoredPath: restoreResult.restoredPath,
  recentlyDeleted: missingFileVersions.length
}, null, 2));
