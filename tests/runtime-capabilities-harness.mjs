import assert from "node:assert/strict";
import { buildRuntimeCapabilityReport } from "../src/runtime-capabilities.ts";
import { DEFAULT_SETTINGS } from "../src/settings.ts";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const readySnapshot = {
  webCrypto: true,
  sessionStorage: true,
  indexedDb: true,
  fetch: true,
  abortController: true,
  textCodec: true,
  base64Codec: true,
  workerConstructor: true,
  workerScriptAvailable: true,
  obsidianRequestApi: true
};

function report(settingsPatch = {}, manifestPatch = {}, snapshotPatch = {}) {
  return buildRuntimeCapabilityReport({
    manifest: {
      id: "light-livesync",
      version: "0.1.0",
      isDesktopOnly: false,
      ...manifestPatch
    },
    settings: {
      ...clone(DEFAULT_SETTINGS),
      ...settingsPatch,
      couchDb: {
        ...clone(DEFAULT_SETTINGS.couchDb),
        ...(settingsPatch.couchDb ?? {})
      }
    },
    snapshot: {
      ...readySnapshot,
      ...snapshotPatch
    }
  });
}

const ready = report();
assert.equal(ready.ok, true);
assert.match(ready.message, /capability check passed/i);
assert.match(ready.details.join(" "), /desktop and mobile/i);
assert.match(ready.details.join(" "), /Background worker path is available/);

const desktopOnly = report({}, { isDesktopOnly: true });
assert.equal(desktopOnly.ok, false);
assert.match(desktopOnly.message, /desktop-only/);

const missingCoreStorage = report({}, {}, {
  webCrypto: false,
  indexedDb: false
});
assert.equal(missingCoreStorage.ok, false);
assert.match(missingCoreStorage.message, /WebCrypto is unavailable/);
assert.match(missingCoreStorage.message, /IndexedDB is unavailable/);

const missingFetch = report({}, {}, { fetch: false });
assert.equal(missingFetch.ok, false);
assert.match(missingFetch.message, /selected fetch transport is unavailable/);

const requestApiTransport = report({
  couchDb: {
    useRequestApi: true
  }
}, {}, {
  fetch: false,
  obsidianRequestApi: true
});
assert.equal(requestApiTransport.ok, true);
assert.match(requestApiTransport.details.join(" "), /Obsidian request API transport is available/);

const missingRequestApiTransport = report({
  couchDb: {
    useRequestApi: true
  }
}, {}, {
  obsidianRequestApi: false
});
assert.equal(missingRequestApiTransport.ok, false);
assert.match(missingRequestApiTransport.message, /selected Obsidian request API transport is unavailable/);

const memoryOnlyUnlock = report({
  keepUnlockedDuringSession: false
}, {}, {
  sessionStorage: false
});
assert.equal(memoryOnlyUnlock.ok, true);
assert.match(memoryOnlyUnlock.details.join(" "), /Session storage is unavailable/);

const missingTextCodecs = report({}, {}, {
  abortController: false,
  textCodec: false,
  base64Codec: false
});
assert.equal(missingTextCodecs.ok, false);
assert.match(missingTextCodecs.message, /AbortController is unavailable/);
assert.match(missingTextCodecs.message, /text codecs are unavailable/);
assert.match(missingTextCodecs.message, /base64 codecs are unavailable/);

const workerFallback = report({}, {}, {
  workerConstructor: false,
  workerScriptAvailable: false
});
assert.equal(workerFallback.ok, true);
assert.match(workerFallback.details.join(" "), /main-thread fallback/);

console.log(JSON.stringify({
  ok: true,
  ready: ready.message,
  desktopOnly: desktopOnly.message,
  missingCoreStorage: missingCoreStorage.message,
  requestApiTransport: requestApiTransport.message,
  missingRequestApiTransport: missingRequestApiTransport.message,
  memoryOnlyUnlock: memoryOnlyUnlock.message,
  workerFallback: workerFallback.message
}, null, 2));
