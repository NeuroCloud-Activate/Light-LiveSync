import assert from "node:assert/strict";
import { decodeSettingsFromSetupUri } from "../src/setup-uri.ts";
import {
  generateAdditionalDeviceSetupUri,
  upstreamSetupFromRuntimeSettings,
  validateSettingsForAdditionalDeviceUri
} from "../src/setup-uri-export.ts";
import { DEFAULT_SETTINGS, settingsFromUpstreamSetup } from "../src/settings.ts";

const runtimeSettings = {
  ...DEFAULT_SETTINGS,
  configured: true,
  couchDb: {
    ...DEFAULT_SETTINGS.couchDb,
    uri: "https://example.invalid:5984",
    database: "testvault",
    username: "device-user",
    password: "device-password"
  },
  passphrase: "shared-e2ee-passphrase",
  remoteState: {
    ...DEFAULT_SETTINGS.remoteState,
    lastCheckedAt: Date.now(),
    databaseName: "testvault",
    syncParametersPresent: true
  }
};

const upstream = upstreamSetupFromRuntimeSettings(runtimeSettings);
assert.equal(upstream.couchDB_URI, runtimeSettings.couchDb.uri);
assert.equal(upstream.couchDB_DBNAME, runtimeSettings.couchDb.database);
assert.equal(upstream.couchDB_USER, runtimeSettings.couchDb.username);
assert.equal(upstream.couchDB_PASSWORD, runtimeSettings.couchDb.password);
assert.equal(upstream.passphrase, runtimeSettings.passphrase);
assert.equal(upstream.encrypt, true);
assert.equal(upstream.usePathObfuscation, true);
assert.equal(upstream.periodicReplicationInterval, runtimeSettings.periodicSyncIntervalSec);

const uri = await generateAdditionalDeviceSetupUri(runtimeSettings);
assert.ok(uri.startsWith("obsidian://setuplivesync?settings="));
assert.ok(!uri.includes("device-password"));
assert.ok(!uri.includes("shared-e2ee-passphrase"));
assert.ok(!uri.includes("device-user"));

const decoded = await decodeSettingsFromSetupUri(uri, runtimeSettings.passphrase);
const projected = settingsFromUpstreamSetup(decoded);
assert.equal(projected.couchDb.uri, runtimeSettings.couchDb.uri);
assert.equal(projected.couchDb.database, runtimeSettings.couchDb.database);
assert.equal(projected.couchDb.username, runtimeSettings.couchDb.username);
assert.equal(projected.couchDb.password, runtimeSettings.couchDb.password);
assert.equal(projected.passphrase, runtimeSettings.passphrase);
assert.equal(projected.deviceSetupRole, "additional-device");
assert.equal(projected.encrypt, true);
assert.equal(projected.requireE2EE, true);
assert.equal(projected.usePathObfuscation, true);
await assert.rejects(() => decodeSettingsFromSetupUri(uri, "wrong-passphrase"));

assert.throws(
  () => validateSettingsForAdditionalDeviceUri({
    ...runtimeSettings,
    remoteState: { ...runtimeSettings.remoteState, syncParametersPresent: false }
  }),
  /initialize the remote database/
);
assert.throws(
  () => validateSettingsForAdditionalDeviceUri({
    ...runtimeSettings,
    couchDb: { ...runtimeSettings.couchDb, password: "" }
  }),
  /Unlock or update/
);

console.log(JSON.stringify({
  ok: true,
  uriPrefix: uri.slice(0, "obsidian://setuplivesync?settings=".length),
  decodedDatabase: projected.couchDb.database,
  decodedUser: projected.couchDb.username,
  decodedDeviceRole: projected.deviceSetupRole,
  e2eeRequired: projected.requireE2EE,
  plaintextSecretsHidden: !uri.includes("device-password") && !uri.includes("shared-e2ee-passphrase")
}, null, 2));
