import assert from "node:assert/strict";
import { decryptCredentialPayload, encryptCredentialPayload } from "../src/credential-store.ts";
import {
  DIRECT_SETUP_FIELD_DESCRIPTIONS,
  directCouchDbSetupInputFromValueSources,
  settingsFromDirectCouchDbSetup,
  validateDirectCouchDbSetupInput
} from "../src/direct-setup.ts";
import { credentialPayloadFromSettings, normaliseCouchDbUri, settingsForDisk } from "../src/settings.ts";

const blankModalState = {
  hostname: "",
  database: "",
  passphrase: "",
  username: "",
  password: ""
};

const inputElements = {
  hostname: { value: "LiveHost.EXAMPLE:5984" },
  database: { value: "ModalDB" },
  passphrase: { value: "modal-secret" },
  username: { value: " modal-user " },
  password: { value: "modal-password" }
};

const fromElements = directCouchDbSetupInputFromValueSources(blankModalState, inputElements);
const fromFallbackState = directCouchDbSetupInputFromValueSources({
  hostname: "FallbackHost:5984",
  database: "FallbackDB",
  passphrase: "fallback-secret",
  username: "fallback-user",
  password: "fallback-password"
}, {});

const projected = settingsFromDirectCouchDbSetup({
  hostname: "Example.COM:5984",
  database: "MixedCaseDB",
  passphrase: "vault-secret",
  username: " couch-user ",
  password: "couch-password"
});

const credentialStore = await encryptCredentialPayload(credentialPayloadFromSettings(projected), projected.passphrase);
const disk = settingsForDisk({
  ...projected,
  credentialStore
});
const unlocked = await decryptCredentialPayload(credentialStore, "vault-secret");

assert.equal(fromElements.hostname, "LiveHost.EXAMPLE:5984");
assert.equal(fromElements.database, "ModalDB");
assert.equal(fromElements.passphrase, "modal-secret");
assert.equal(fromElements.username, " modal-user ");
assert.equal(fromElements.password, "modal-password");
assert.equal(fromFallbackState.hostname, "FallbackHost:5984");
assert.equal(fromFallbackState.database, "FallbackDB");
assert.throws(() => validateDirectCouchDbSetupInput({ ...blankModalState, hostname: "   " }), /hostname is required/);
assert.equal(projected.couchDb.uri, "http://example.com:5984");
assert.equal(projected.couchDb.database, "mixedcasedb");
assert.equal(projected.couchDb.username, "couch-user");
assert.equal(projected.couchDb.password, "couch-password");
assert.equal(projected.passphrase, "vault-secret");
assert.equal(projected.deviceSetupRole, "initial-device");
assert.equal(projected.requireE2EE, true);
assert.equal(projected.encrypt, true);
assert.equal(projected.usePathObfuscation, true);
assert.equal(projected.syncOnSave, true);
assert.equal(projected.periodicSync, true);
assert.equal(projected.vaultChangeBatchWindowSec, 60);
assert.equal(projected.maxPushChangesPerSync, 1000);
assert.equal(projected.autoUnlockCredentials, true);
assert.equal(normaliseCouchDbUri("203.0.113.10:5984"), "http://203.0.113.10:5984");
assert.equal(normaliseCouchDbUri("HTTPS://Sync.Example.COM:443/couch/"), "https://sync.example.com/couch");
assert.equal(disk.couchDb.password, "");
assert.equal(disk.passphrase, "");
assert.equal(unlocked.couchDbPassword, "couch-password");
assert.equal(unlocked.passphrase, "vault-secret");
assert.ok(DIRECT_SETUP_FIELD_DESCRIPTIONS.hostname.description.includes("CouchDB server"));
assert.ok(DIRECT_SETUP_FIELD_DESCRIPTIONS.passphrase.description.includes("E2EE"));
assert.ok(DIRECT_SETUP_FIELD_DESCRIPTIONS.username.description.includes("restricts access"));

console.log(JSON.stringify({
  ok: true,
  uri: projected.couchDb.uri,
  database: projected.couchDb.database,
  deviceSetupRole: projected.deviceSetupRole,
  e2eeRequired: projected.requireE2EE,
  maxPushChangesPerSync: projected.maxPushChangesPerSync,
  encryptedCredentialStore: !!disk.credentialStore,
  diskSecretsBlanked: disk.couchDb.password === "" && disk.passphrase === "",
  readsSubmittedInputValues: fromElements.hostname === "LiveHost.EXAMPLE:5984",
  describedFields: Object.keys(DIRECT_SETUP_FIELD_DESCRIPTIONS)
}, null, 2));
