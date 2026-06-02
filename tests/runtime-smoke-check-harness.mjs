import assert from "node:assert/strict";
import { buildRuntimeSmokeCheckReport } from "../src/runtime-smoke-check.ts";
import { DEFAULT_SETTINGS } from "../src/settings.ts";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function report(settingsPatch, manifestPatch = {}) {
  return buildRuntimeSmokeCheckReport({
    manifest: {
      id: "light-livesync",
      version: "0.1.1",
      isDesktopOnly: false,
      ...manifestPatch
    },
    settings: {
      ...clone(DEFAULT_SETTINGS),
      ...settingsPatch,
      couchDb: {
        ...clone(DEFAULT_SETTINGS.couchDb),
        ...(settingsPatch.couchDb ?? {})
      },
      remoteState: {
        ...clone(DEFAULT_SETTINGS.remoteState),
        ...(settingsPatch.remoteState ?? {})
      },
      localQueue: {
        ...clone(DEFAULT_SETTINGS.localQueue),
        ...(settingsPatch.localQueue ?? {})
      },
      runtime: {
        ...clone(DEFAULT_SETTINGS.runtime),
        ...(settingsPatch.runtime ?? {}),
        lastSyncMetrics: {
          ...clone(DEFAULT_SETTINGS.runtime.lastSyncMetrics),
          ...(settingsPatch.runtime?.lastSyncMetrics ?? {})
        }
      }
    },
    workerScriptAvailable: true
  });
}

const ready = report({
  configured: true,
  couchDb: {
    uri: "http://example.com:5984",
    database: "vault",
    username: "user",
    password: "password"
  },
  passphrase: "secret",
  remoteState: {
    lastCheckedAt: Date.now(),
    syncParametersPresent: true
  }
});
assert.equal(ready.ok, true);
assert.match(ready.message, /Runtime check passed/);
assert.match(ready.details.join(" "), /Desktop and mobile manifest/);
assert.match(ready.details.join(" "), /standard fetch/);
assert.match(ready.details.join(" "), /Device role: initial device/);
assert.match(ready.details.join(" "), /Device credential restore is enabled/);
assert.match(ready.details.join(" "), /Session credential cache is enabled/);
assert.match(ready.details.join(" "), /Automatic remote apply is enabled/);
assert.match(ready.details.join(" "), /Text differences are merged automatically/);
assert.match(ready.details.join(" "), /default plugin conflict folder/);
assert.match(ready.details.join(" "), /Last workload/);

const missingSetup = report({});
assert.equal(missingSetup.ok, false);
assert.match(missingSetup.message, /CouchDB setup is missing/);

const additionalDevice = report({
  configured: true,
  deviceSetupRole: "additional-device",
  couchDb: {
    uri: "http://example.com:5984",
    database: "vault",
    username: "user",
    password: "password"
  },
  passphrase: "secret",
  remoteState: {
    lastCheckedAt: Date.now(),
    syncParametersPresent: true
  }
});
assert.equal(additionalDevice.ok, true);
assert.match(additionalDevice.details.join(" "), /Device role: additional device/);

const locked = report({
  configured: true,
  couchDb: {
    uri: "http://example.com:5984",
    database: "vault",
    username: "user",
    password: ""
  },
  credentialStore: { version: 1 },
  passphrase: ""
});
assert.equal(locked.ok, false);
assert.match(locked.message, /saved credentials could not be opened/);
assert.match(locked.message, /E2EE passphrase is not available/);

const memoryOnly = report({
  configured: true,
  autoUnlockCredentials: false,
  keepUnlockedDuringSession: false,
  couchDb: {
    uri: "http://example.com:5984",
    database: "vault",
    username: "user",
    password: "password"
  },
  passphrase: "secret",
  remoteState: {
    lastCheckedAt: Date.now(),
    syncParametersPresent: true
  }
});
assert.equal(memoryOnly.ok, true);
assert.match(memoryOnly.details.join(" "), /Device credential restore is disabled/);
assert.match(memoryOnly.details.join(" "), /credentials are memory-only/);

const desktopOnly = report({
  configured: true,
  couchDb: {
    uri: "http://example.com:5984",
    database: "vault",
    username: "user",
    password: "password"
  },
  passphrase: "secret",
  remoteState: {
    lastCheckedAt: Date.now(),
    syncParametersPresent: true
  }
}, { isDesktopOnly: true });
assert.equal(desktopOnly.ok, false);
assert.match(desktopOnly.message, /desktop-only/);

const manualApply = report({
  configured: true,
  autoApplyPull: false,
  couchDb: {
    uri: "http://example.com:5984",
    database: "vault",
    username: "user",
    password: "password"
  },
  passphrase: "secret",
  remoteState: {
    lastCheckedAt: Date.now(),
    syncParametersPresent: true
  },
  conflictFolder: "sync-recovery"
});
assert.equal(manualApply.ok, false);
assert.match(manualApply.message, /automatic remote apply is disabled/);
assert.match(manualApply.details.join(" "), /custom conflict folder/);

console.log(JSON.stringify({
  ok: true,
  ready: ready.message,
  additionalDevice: additionalDevice.message,
  missingSetup: missingSetup.message,
  locked: locked.message,
  memoryOnly: memoryOnly.message,
  desktopOnly: desktopOnly.message,
  manualApply: manualApply.message
}, null, 2));
