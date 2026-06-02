import assert from "node:assert/strict";
import { OptionalSyncWorkerClient } from "../src/sync-worker-client.ts";

const snapshot = {
  path: "fallback.md",
  content: "Fallback push builder check.\n",
  ctime: 1,
  mtime: 2,
  size: 29
};
const options = {
  encrypt: false,
  passphrase: "",
  syncParameterSalt: "",
  usePathObfuscation: false,
  hashAlgorithm: "xxhash64"
};

let disabledYields = 0;
const disabledClient = new OptionalSyncWorkerClient({
  enabled: () => false,
  scriptUrl: () => "unused-worker.js",
  yieldToUi: async () => {
    disabledYields += 1;
  },
  log: () => {}
});
const disabledResult = await disabledClient.buildPushBundle(snapshot, options);

let unavailableYields = 0;
const unavailableLogs = [];
const unavailableClient = new OptionalSyncWorkerClient({
  enabled: () => true,
  scriptUrl: () => undefined,
  yieldToUi: async () => {
    unavailableYields += 1;
  },
  log: (message) => unavailableLogs.push(message)
});
const unavailableResult = await unavailableClient.buildPushBundle(snapshot, options);

let largeFallbackYields = 0;
const largeFallbackClient = new OptionalSyncWorkerClient({
  enabled: () => false,
  scriptUrl: () => "unused-worker.js",
  yieldToUi: async () => {
    largeFallbackYields += 1;
  },
  log: () => {}
});
const largeFallbackResult = await largeFallbackClient.buildPushBundle({
  path: "large-fallback.md",
  content: `${"Large fallback line.\n".repeat(20000)}`,
  ctime: 3,
  mtime: 4,
  size: 420_000
}, options);

assert.equal(disabledYields, 1);
assert.equal(unavailableYields, 1);
assert.ok(largeFallbackYields > 1, `expected cooperative yields during a large main-thread fallback build, got ${largeFallbackYields}`);
assert.equal(disabledResult.fileDocument._id, "fallback.md");
assert.equal(unavailableResult.fileDocument._id, "fallback.md");
assert.equal(largeFallbackResult.fileDocument._id, "large-fallback.md");
assert.ok(largeFallbackResult.chunkDocuments.length > 1);
assert.match(unavailableLogs.join(" "), /Background worker unavailable/);

console.log(JSON.stringify({
  ok: true,
  disabledYields,
  unavailableYields,
  largeFallbackYields,
  disabledChunks: disabledResult.chunkDocuments.length,
  unavailableChunks: unavailableResult.chunkDocuments.length,
  largeFallbackChunks: largeFallbackResult.chunkDocuments.length,
  fallbackLogged: /Background worker unavailable/.test(unavailableLogs.join(" "))
}, null, 2));
