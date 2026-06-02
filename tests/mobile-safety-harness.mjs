import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const sourceDir = "src";
const sourceFiles = walk(sourceDir).filter((file) => file.endsWith(".ts"));
const forbiddenSourcePatterns = [
  {
    label: "Node built-in import",
    pattern: /from\s+["']node:/,
    reason: "Obsidian mobile cannot load Node built-ins from plugin source."
  },
  {
    label: "Electron import",
    pattern: /from\s+["']electron["']/,
    reason: "Electron APIs are desktop-only and must not be required for sync."
  },
  {
    label: "CommonJS require",
    pattern: /\brequire\s*\(/,
    reason: "Bundled mobile plugin code should not depend on runtime CommonJS loading."
  },
  {
    label: "Node process global",
    pattern: /\bprocess\./,
    reason: "The plugin runtime should not depend on Node's process object."
  },
  {
    label: "Node Buffer global",
    pattern: /\bBuffer\./,
    reason: "The plugin runtime should use browser byte and base64 helpers instead of Buffer."
  }
];
const forbiddenRuntimeDependencies = [
  "electron",
  "fs",
  "fs-extra",
  "path",
  "chokidar",
  "pouchdb",
  "level",
  "sqlite3"
];

function walk(dir) {
  const result = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const info = statSync(path);
    if (info.isDirectory()) {
      result.push(...walk(path));
    } else if (info.isFile()) {
      result.push(path);
    }
  }
  return result;
}

function assertNoPattern(path, content, check) {
  assert.equal(
    check.pattern.test(content),
    false,
    `${path} matched ${check.label}. ${check.reason}`
  );
}

for (const file of sourceFiles) {
  const content = readFileSync(file, "utf8");
  for (const check of forbiddenSourcePatterns) {
    assertNoPattern(file, content, check);
  }
}

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
assert.equal(manifest.isDesktopOnly, false);

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const dependencies = {
  ...(packageJson.dependencies ?? {}),
  ...(packageJson.optionalDependencies ?? {})
};
for (const dependency of forbiddenRuntimeDependencies) {
  assert.equal(
    Object.hasOwn(dependencies, dependency),
    false,
    `${dependency} must not be a runtime dependency for the mobile-capable plugin.`
  );
}

if (existsSync("main.js")) {
  const main = readFileSync("main.js", "utf8");
  const mainRequires = [...main.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(mainRequires)], ["obsidian"]);
  assert.equal(/require\("electron"\)/.test(main), false);
  assert.equal(/require\("node:/.test(main), false);
  assert.equal(main.includes("build-push-bundle"), true);
  assert.equal(main.includes("Background worker file was not found; using the built-in worker source instead."), true);
}

if (existsSync("sync-worker.js")) {
  const worker = readFileSync("sync-worker.js", "utf8");
  const workerRequires = [...worker.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]);
  assert.deepEqual(workerRequires, []);
  assert.equal(worker.includes("onmessage"), true);
  assert.equal(worker.includes("module.exports") || worker.includes("exports."), false);
}

console.log(JSON.stringify({
  ok: true,
  sourceFiles: sourceFiles.length,
  isDesktopOnly: manifest.isDesktopOnly,
  runtimeDependencies: Object.keys(dependencies).sort(),
  checkedBundles: {
    main: existsSync("main.js"),
    worker: existsSync("sync-worker.js")
  }
}, null, 2));
