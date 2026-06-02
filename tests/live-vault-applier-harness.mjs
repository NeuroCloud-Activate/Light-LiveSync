#!/usr/bin/env node

import assert from "node:assert/strict";
import { applyReadyPreviewsToLiveVault } from "../src/live-vault-applier.ts";

class MemoryVault {
  files = new Map();
  folders = new Set();
  adapter = {
    exists: async (path) => this.files.has(path) || this.folders.has(path),
    mkdir: async (path) => {
      this.folders.add(path);
    }
  };

  getAbstractFileByPath(path) {
    return this.files.has(path) ? { path } : null;
  }

  async read(file) {
    if (!this.files.has(file.path)) {
      throw new Error(`Missing file: ${file.path}`);
    }
    return this.files.get(file.path);
  }

  async readBinary(file) {
    if (!this.files.has(file.path)) {
      throw new Error(`Missing file: ${file.path}`);
    }
    const value = this.files.get(file.path);
    if (value instanceof ArrayBuffer) {
      return value;
    }
    return new TextEncoder().encode(value).buffer;
  }

  async create(path, content) {
    this.files.set(path, content);
    return { path };
  }

  async createBinary(path, content) {
    this.files.set(path, content);
    return { path };
  }

  async modify(file, content) {
    this.files.set(file.path, content);
  }

  async modifyBinary(file, content) {
    this.files.set(file.path, content);
  }

  async delete(file) {
    this.files.delete(file.path);
  }
}

const vault = new MemoryVault();
vault.files.set("notes/a.md", "local");

const writeResult = await applyReadyPreviewsToLiveVault(
  vault,
  [
    {
      id: "doc-a",
      rev: "1-a",
      path: "notes/a.md",
      status: "ready",
      contentType: "text",
      chunkCount: 1,
      byteLength: 6,
      content: "remote"
    }
  ],
  {
    configDir: ".obsidian",
    conflictFolder: ".obsidian/plugins/light-livesync/conflicts"
  }
);

assert.equal(writeResult.applied, 0);
assert.equal(writeResult.merged, 1);
assert.equal(writeResult.backedUp, 1);
assert.equal(writeResult.conflicted, 0);
assert.equal(vault.files.get("notes/a.md"), "local\nremote");
assert.equal([...vault.files.values()].includes("local"), true);

const deleteResult = await applyReadyPreviewsToLiveVault(
  vault,
  [
    {
      id: "doc-a-delete",
      rev: "2-a",
      path: "notes/a.md",
      status: "deleted",
      contentType: "text",
      chunkCount: 0,
      byteLength: 0
    }
  ],
  {
    configDir: ".obsidian",
    conflictFolder: ".obsidian/plugins/light-livesync/conflicts"
  }
);

assert.equal(deleteResult.deleted, 1);
assert.equal(deleteResult.backedUp, 1);
assert.equal(deleteResult.conflicted, 0);
assert.equal(vault.files.has("notes/a.md"), false);
assert.equal([...vault.files.values()].includes("local\nremote"), true);

const configResult = await applyReadyPreviewsToLiveVault(
  vault,
  [
    {
      id: "doc-protected",
      rev: "1-p",
      path: ".obsidian/app.json",
      status: "ready",
      contentType: "text",
      chunkCount: 1,
      byteLength: 2,
      content: "{}"
    }
  ],
  {
    configDir: ".obsidian",
    conflictFolder: ".obsidian/plugins/light-livesync/conflicts"
  }
);

assert.equal(configResult.applied, 1);
assert.equal(configResult.skipped, 0);
assert.equal(vault.files.get(".obsidian/app.json"), "{}");

const binary = new Uint8Array([1, 2, 3, 4]).buffer;
let applyYields = 0;
const binaryResult = await applyReadyPreviewsToLiveVault(
  vault,
  [
    {
      id: "doc-binary",
      rev: "1-b",
      path: "assets/a.bin",
      status: "ready",
      contentType: "binary",
      chunkCount: 1,
      byteLength: 4,
      content: binary
    }
  ],
  {
    configDir: ".obsidian",
    conflictFolder: ".obsidian/plugins/light-livesync/conflicts",
    yieldToUi: async () => {
      applyYields += 1;
    }
  }
);

assert.equal(binaryResult.applied, 1);
assert.deepEqual([...new Uint8Array(vault.files.get("assets/a.bin"))], [1, 2, 3, 4]);
assert.equal(applyYields, 2);

console.log(JSON.stringify({
  ok: true,
  merged: writeResult.merged,
  backups: writeResult.backedUp + deleteResult.backedUp,
  conflicts: writeResult.conflicted + deleteResult.conflicted,
  configSynced: vault.files.get(".obsidian/app.json") === "{}",
  binary: true,
  applyYields
}, null, 2));
