import { decodeSettingsFromSetupQr } from "../src/setup-qr.ts";
import { settingsForDisk, settingsFromUpstreamSetup } from "../src/settings.ts";

const qrSettings = [];
qrSettings[2] = "localhost:5984";
qrSettings[3] = "user";
qrSettings[4] = "secret-password";
qrSettings[5] = "MixedCaseDB";
qrSettings[8] = true;
qrSettings[9] = "vault-secret";
qrSettings[10] = true;
qrSettings[24] = true;
qrSettings[32] = "xxhash64";
qrSettings[50] = true;
qrSettings[51] = true;
qrSettings[78] = true;
qrSettings[79] = 45;
qrSettings[133] = "{\"X-Test\":\"ok\"}";
qrSettings[143] = true;
qrSettings[147] = "v2";
qrSettings[157] = {
  "legacy-couchdb": {
    id: "legacy-couchdb",
    couchDB_URI: "Example.COM:5984",
    couchDB_DBNAME: "RemoteDB",
    couchDB_USER: "remote-user",
    couchDB_PASSWORD: "remote-secret",
    couchDB_CustomHeaders: "{\"X-Remote\":\"ok\"}",
    useRequestAPI: true
  }
};
qrSettings[158] = "legacy-couchdb";

const encoded = encodeURIComponent(JSON.stringify(qrSettings));
const decoded = decodeSettingsFromSetupQr(`obsidian://setuplivesync?settingsQR=${encoded}`);
const projected = settingsFromUpstreamSetup(decoded);
const disk = settingsForDisk(projected);

if (projected.deviceSetupRole !== "additional-device") {
  throw new Error(`Expected QR import to use additional-device role, got ${projected.deviceSetupRole}.`);
}

console.log(JSON.stringify({
  ok: true,
  decodedRemote: decoded.activeConfigurationId,
  uri: projected.couchDb.uri,
  database: projected.couchDb.database,
  username: projected.couchDb.username,
  hasPasswordInMemory: projected.couchDb.password === "remote-secret",
  hasPassphraseInMemory: projected.passphrase === "vault-secret",
  deviceSetupRole: projected.deviceSetupRole,
  encrypt: projected.encrypt,
  requireE2EE: projected.requireE2EE,
  periodicInterval: projected.periodicSyncIntervalSec,
  diskPasswordBlanked: disk.couchDb.password === "",
  diskPassphraseBlanked: disk.passphrase === ""
}, null, 2));
