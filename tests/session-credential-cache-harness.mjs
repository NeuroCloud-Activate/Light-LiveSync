import assert from "node:assert/strict";
import {
  clearSessionCredentialReloadProof,
  clearSessionCredentialPayload,
  loadSessionCredentialPayload,
  saveSessionCredentialPayload,
  saveSessionCredentialReloadProof,
  verifySessionCredentialReloadProof
} from "../src/session-credential-cache.ts";

class MemorySessionStorage {
  constructor() {
    this.items = new Map();
  }

  getItem(key) {
    return this.items.has(key) ? this.items.get(key) : null;
  }

  setItem(key, value) {
    this.items.set(key, String(value));
  }

  removeItem(key) {
    this.items.delete(key);
  }
}

globalThis.sessionStorage = new MemorySessionStorage();

const scope = {
  vaultName: "ExampleVault",
  pluginId: "lightweight-livesync",
  uri: "http://example.com:5984",
  database: "testingob",
  username: "user"
};
const payload = {
  couchDbPassword: "server-password",
  passphrase: "vault-passphrase"
};

assert.equal(await saveSessionCredentialPayload(scope, payload), true);

const storageEntries = [...globalThis.sessionStorage.items.entries()];
assert.equal(storageEntries.length, 1);
assert.equal(storageEntries[0][1].includes(payload.couchDbPassword), false);
assert.equal(storageEntries[0][1].includes(payload.passphrase), false);

const restored = await loadSessionCredentialPayload(scope);
assert.deepEqual(restored, payload);

const mismatched = await loadSessionCredentialPayload({
  ...scope,
  database: "other-vault"
});
assert.equal(mismatched, null);
assert.equal(globalThis.sessionStorage.items.size, 1);

globalThis.sessionStorage.setItem(storageEntries[0][0], "{not-json");
const corrupted = await loadSessionCredentialPayload(scope);
assert.equal(corrupted, null);
assert.equal(globalThis.sessionStorage.items.size, 0);

await saveSessionCredentialPayload(scope, payload);
clearSessionCredentialPayload(scope);
assert.equal(await loadSessionCredentialPayload(scope), null);
assert.equal(globalThis.sessionStorage.items.size, 0);

assert.equal(await saveSessionCredentialReloadProof(scope, payload), true);
const proofEntries = [...globalThis.sessionStorage.items.entries()];
assert.equal(proofEntries.length, 1);
assert.equal(proofEntries[0][1].includes(payload.couchDbPassword), false);
assert.equal(proofEntries[0][1].includes(payload.passphrase), false);
assert.equal(await verifySessionCredentialReloadProof(scope, payload), "matched");
assert.equal(await verifySessionCredentialReloadProof(scope, {
  ...payload,
  passphrase: "wrong-vault-passphrase"
}), "mismatch");
assert.equal(await verifySessionCredentialReloadProof({
  ...scope,
  username: "other-user"
}, payload), "mismatch");
clearSessionCredentialReloadProof(scope);
assert.equal(await verifySessionCredentialReloadProof(scope, payload), "missing");
assert.equal(globalThis.sessionStorage.items.size, 0);

console.log(JSON.stringify({
  ok: true,
  cases: [
    "save hides plaintext",
    "load restores scoped payload",
    "scope mismatch rejected",
    "corrupt cache cleared",
    "explicit clear removes token",
    "reload proof hides plaintext",
    "reload proof verifies scoped payload",
    "reload proof rejects wrong payload",
    "reload proof clear removes token"
  ]
}, null, 2));
