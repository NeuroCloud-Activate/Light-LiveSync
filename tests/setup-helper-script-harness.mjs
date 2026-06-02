import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const script = await readFile("utils/couchdb_setupuri.ts", "utf8");

assert.match(script, /requiredEnv\("hostname"\)/);
assert.match(script, /requiredEnv\("database"\)/);
assert.match(script, /requiredEnv\("passphrase"\)/);
assert.match(script, /requiredEnv\("username"\)/);
assert.match(script, /requiredEnv\("password"\)/);
assert.match(script, /Deno\.env\.get\(name\)/);
assert.match(script, /normaliseCouchDbUri/);
assert.match(script, /ensureDatabase/);
assert.match(script, /secureDatabase/);
assert.match(script, /ensureSyncParameters/);
assert.match(script, /obsidian:\/\/setuplivesync\?settings=/);
assert.doesNotMatch(script, /192\.168\./);

console.log(JSON.stringify({
  ok: true,
  envFields: ["hostname", "database", "passphrase", "username", "password"],
  createsDatabase: true,
  preparesSetupUri: true
}, null, 2));
