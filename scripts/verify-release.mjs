#!/usr/bin/env node

import assert from "node:assert/strict";
import { access, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const expectedId = "light-livesync";
const expectedName = "Light-LiveSync";
const expectedVersion = "0.1.5";
const expectedMinAppVersion = "1.5.0";
const expectedFiles = ["main.js", "manifest.json", "styles.css", "sync-worker.js"];
const expectedZipEntries = expectedFiles.map((file) => `light-livesync/${file}`).sort();
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

const releaseDir = "release/light-livesync";
const zipPath = "release/light-livesync.zip";
const rootManifest = JSON.parse(await readFile("manifest.json", "utf8"));
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const versions = JSON.parse(await readFile("versions.json", "utf8"));
const readme = await readFile("README.md", "utf8");
const license = await readFile("LICENSE", "utf8");

assert.equal(rootManifest.id, expectedId);
assert.equal(rootManifest.name, expectedName);
assert.equal(rootManifest.version, expectedVersion);
assert.equal(rootManifest.minAppVersion, expectedMinAppVersion);
assert.equal(rootManifest.isDesktopOnly, false);
assert.equal(typeof rootManifest.description, "string");
assert.equal(rootManifest.description.length > 20, true);
assert.equal(rootManifest.description.includes("Obsidian"), false);
assert.equal(rootManifest.author, "NeuroCloud");
assert.equal(rootManifest.authorUrl, "https://github.com/NeuroCloud-Activate");
assert.notEqual(rootManifest.authorUrl, "https://github.com/NeuroCloud-Activate/Light-LiveSync");
assert.equal(packageJson.name, expectedId);
assert.equal(packageJson.version, expectedVersion);
assert.equal(versions[expectedVersion], expectedMinAppVersion);
assert.equal(readme.includes("# Light-LiveSync"), true);
assert.equal(readme.includes("OpenAI Codex"), true);
assert.equal(license.includes("MIT License"), true);
await access("CHANGELOG.md");

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
assert.deepEqual(manifest, rootManifest);
assert.equal(manifest.id, expectedId);
assert.equal(manifest.name, expectedName);
assert.equal(manifest.version, expectedVersion);
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
  main.includes("Light-LiveSync Runtime Evidence"),
  true,
  "main.js must include the runtime evidence report template"
);
assert.equal(
  main.includes("This report intentionally excludes CouchDB hostnames"),
  true,
  "main.js must include non-secret evidence report redaction language"
);
assert.equal(
  main.includes("Light-LiveSync Evidence"),
  true,
  "main.js must include the runtime evidence report folder"
);

console.log(JSON.stringify({
  ok: true,
  id: manifest.id,
  name: manifest.name,
  version: manifest.version,
  files,
  zipEntries: expectedZipEntries,
  isDesktopOnly: manifest.isDesktopOnly,
  evidenceReportCommand: true,
  mainRequires: [...new Set(mainRequires)],
  workerRequires
}, null, 2));
