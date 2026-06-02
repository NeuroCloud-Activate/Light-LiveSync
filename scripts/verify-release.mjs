#!/usr/bin/env node

import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const expectedFiles = ["main.js", "manifest.json", "styles.css", "sync-worker.js"];
const expectedZipEntries = expectedFiles.map((file) => `lightweight-livesync/${file}`).sort();
const forbiddenPatterns = [
  /\/Users\//i,
  /BEGIN (RSA|OPENSSH|PRIVATE) KEY/i
];

function centralDirectoryEntries(zip) {
  const entries = [];
  let cursor = 0;
  while (cursor < zip.length - 4) {
    const signature = zip.readUInt32LE(cursor);
    if (signature === 0x02014b50) {
      const nameLength = zip.readUInt16LE(cursor + 28);
      const extraLength = zip.readUInt16LE(cursor + 30);
      const commentLength = zip.readUInt16LE(cursor + 32);
      const nameStart = cursor + 46;
      const name = zip.subarray(nameStart, nameStart + nameLength).toString("utf8");
      entries.push(name);
      cursor = nameStart + nameLength + extraLength + commentLength;
      continue;
    }
    cursor += 1;
  }
  return entries.sort();
}

async function assertNoForbiddenStrings(path) {
  const content = await readFile(path, "utf8");
  for (const pattern of forbiddenPatterns) {
    assert.equal(pattern.test(content), false, `${path} contains forbidden private pattern ${pattern}`);
  }
}

const releaseDir = "release/lightweight-livesync";
const zipPath = "release/lightweight-livesync.zip";
const files = (await readdir(releaseDir)).sort();
assert.deepEqual(files, expectedFiles);

for (const file of expectedFiles) {
  const path = join(releaseDir, file);
  const info = await stat(path);
  assert.equal(info.isFile(), true, `${path} must be a file`);
  assert.equal(info.size > 0, true, `${path} must not be empty`);
  await assertNoForbiddenStrings(path);
}

const zip = await readFile(zipPath);
assert.equal(zip.length > 0, true, "release zip must not be empty");
assert.deepEqual(centralDirectoryEntries(zip), expectedZipEntries);

const manifest = JSON.parse(await readFile(join(releaseDir, "manifest.json"), "utf8"));
assert.equal(manifest.id, "lightweight-livesync");
assert.equal(manifest.isDesktopOnly, false);

const main = await readFile(join(releaseDir, "main.js"), "utf8");
const worker = await readFile(join(releaseDir, "sync-worker.js"), "utf8");
const mainRequires = [...main.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]);
const workerRequires = [...worker.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]);

assert.deepEqual([...new Set(mainRequires)], ["obsidian"]);
assert.deepEqual(workerRequires, []);
assert.equal(worker.includes("onmessage"), true);
assert.equal(worker.includes("module.exports") || worker.includes("exports."), false);
assert.equal(
  main.includes("write-runtime-evidence-report"),
  true,
  "main.js must include the runtime evidence report command"
);
assert.equal(
  main.includes("Lightweight LiveSync Runtime Evidence"),
  true,
  "main.js must include the runtime evidence report template"
);
assert.equal(
  main.includes("This report intentionally excludes CouchDB hostnames"),
  true,
  "main.js must include non-secret evidence report redaction language"
);
assert.equal(
  main.includes("Lightweight LiveSync Evidence"),
  true,
  "main.js must include the runtime evidence report folder"
);

console.log(JSON.stringify({
  ok: true,
  files,
  zipEntries: expectedZipEntries,
  isDesktopOnly: manifest.isDesktopOnly,
  evidenceReportCommand: true,
  mainRequires: [...new Set(mainRequires)],
  workerRequires
}, null, 2));
