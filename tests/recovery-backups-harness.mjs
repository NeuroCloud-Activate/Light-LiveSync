#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  inferOriginalPathFromRecoveryBackup,
  listRecoveryBackups,
  restoreRecoveryBackup
} from "../src/recovery-backups.ts";

class MemoryAdapter {
  files = new Map();
  folders = new Set();

  async exists(path) {
    return this.files.has(path) || this.folders.has(path);
  }

  async mkdir(path) {
    this.folders.add(path);
  }

  async stat(path) {
    const value = this.files.get(path);
    if (value === undefined) {
      return null;
    }
    return {
      ctime: 1,
      mtime: path.includes("newer") ? 300 : 200,
      size: value instanceof ArrayBuffer ? value.byteLength : value.length
    };
  }

  async list(path) {
    const prefix = `${path}/`;
    const files = [];
    const folders = new Set();
    for (const filePath of this.files.keys()) {
      if (!filePath.startsWith(prefix)) {
        continue;
      }
      const relative = filePath.slice(prefix.length);
      const folder = relative.split("/").slice(0, -1)[0];
      if (folder) {
        folders.add(`${path}/${folder}`);
      } else {
        files.push(filePath);
      }
    }
    return { files, folders: [...folders] };
  }

  async read(path) {
    return this.files.get(path);
  }

  async readBinary(path) {
    return this.files.get(path);
  }

  async write(path, data) {
    this.files.set(path, data);
  }

  async writeBinary(path, data) {
    this.files.set(path, data);
  }
}

const conflictFolder = ".obsidian/plugins/light-livesync/conflicts";
const oldBackup = `${conflictFolder}/notes/a.md.local-conflict-2026-06-02T01-00-00-000Z`;
const newerBackup = `${conflictFolder}/notes/a.md.local-conflict-2026-06-02T02-00-00-000Z`;
const binaryBackup = `${conflictFolder}/assets/a.bin.local-conflict-2026-06-02T03-00-00-000Z`;
const ignored = `${conflictFolder}/notes/not-a-backup.md`;

const adapter = new MemoryAdapter();
adapter.folders.add(conflictFolder);
adapter.files.set("notes/a.md", "current");
adapter.files.set(oldBackup, "old");
adapter.files.set(newerBackup, "restored text");
adapter.files.set(binaryBackup, new Uint8Array([7, 8, 9]).buffer);
adapter.files.set(ignored, "ignore");

assert.equal(inferOriginalPathFromRecoveryBackup(conflictFolder, newerBackup), "notes/a.md");
assert.equal(inferOriginalPathFromRecoveryBackup(conflictFolder, ignored), undefined);

const backups = await listRecoveryBackups(adapter, conflictFolder, 10);
assert.equal(backups.length, 3);
assert.equal(backups.some((entry) => entry.originalPath === "assets/a.bin"), true);

const textEntry = backups.find((entry) => entry.backupPath === newerBackup);
assert.equal(textEntry.originalPath, "notes/a.md");

const restoreResult = await restoreRecoveryBackup(adapter, textEntry, conflictFolder);
assert.equal(restoreResult.restoredPath, "notes/a.md");
assert.equal(restoreResult.createdPreRestoreBackup, true);
assert.equal(adapter.files.get("notes/a.md"), "restored text");
assert.equal([...adapter.files.values()].includes("current"), true);

const binaryEntry = backups.find((entry) => entry.originalPath === "assets/a.bin");
const binaryResult = await restoreRecoveryBackup(adapter, binaryEntry, conflictFolder);
assert.equal(binaryResult.restoredPath, "assets/a.bin");
assert.equal(binaryResult.createdPreRestoreBackup, false);
assert.deepEqual([...new Uint8Array(adapter.files.get("assets/a.bin"))], [7, 8, 9]);

console.log(JSON.stringify({
  ok: true,
  discovered: backups.length,
  restored: restoreResult.restoredPath,
  currentWasBackedUp: restoreResult.createdPreRestoreBackup,
  binaryRestored: true
}, null, 2));
