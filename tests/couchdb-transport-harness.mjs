import assert from "node:assert/strict";
import { CouchDbClient, CouchDbClientError } from "../src/couchdb-client.ts";

function createClient(useRequestApi = false) {
  return new CouchDbClient({
    uri: "http://example.invalid:5984",
    database: "transportcheck",
    username: "user",
    password: "password",
    customHeaders: "",
    useRequestApi
  });
}

const originalFetch = globalThis.fetch;

let fetchCalls = 0;
globalThis.fetch = async (url, options) => {
  fetchCalls += 1;
  assert.equal(url, "http://example.invalid:5984");
  assert.equal(options.method, "GET");
  assert.match(options.headers.Authorization, /^Basic /);
  return new Response(JSON.stringify({ version: "fetch-default" }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
};

try {
  const server = await createClient(false).getServerInfo();
  assert.equal(server.version, "fetch-default");
  assert.equal(fetchCalls, 1);
} finally {
  globalThis.fetch = originalFetch;
}

process.env.OBSIDIAN_STUB_REQUEST_URL_MODE = "address-unreachable";
await assert.rejects(
  () => createClient(true).getServerInfo(),
  (error) => {
    assert.equal(error instanceof CouchDbClientError, true);
    assert.match(error.message, /Could not reach CouchDB/);
    assert.match(error.message, /local-network access/);
    assert.match(error.message, /ERR_ADDRESS_UNREACHABLE/);
    return true;
  }
);

const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
let shortenedTimeouts = 0;
globalThis.setTimeout = (callback, ms, ...args) => {
  if (ms === 20_000) {
    shortenedTimeouts += 1;
    return originalSetTimeout(callback, 1, ...args);
  }
  return originalSetTimeout(callback, ms, ...args);
};
globalThis.clearTimeout = (handle) => originalClearTimeout(handle);

try {
  process.env.OBSIDIAN_STUB_REQUEST_URL_MODE = "hang";
  await assert.rejects(
    () => createClient(true).getServerInfo(),
    (error) => {
      assert.equal(error instanceof CouchDbClientError, true);
      assert.match(error.message, /within 20 seconds/);
      assert.match(error.message, /server reachability/);
      return true;
    }
  );
} finally {
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
  delete process.env.OBSIDIAN_STUB_REQUEST_URL_MODE;
}

assert.equal(shortenedTimeouts, 1);

const originalUnauthorizedFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "http://example.invalid:5984/transportcheck");
  assert.match(options.headers.Authorization, /^Basic /);
  return new Response(JSON.stringify({ error: "unauthorized", reason: "Name or password is incorrect." }), {
    status: 401,
    headers: { "Content-Type": "application/json" }
  });
};

try {
  await assert.rejects(
    () => createClient(false).getDatabaseInfo(),
    (error) => {
      assert.equal(error instanceof CouchDbClientError, true);
      assert.equal(error.status, 401);
      assert.match(error.message, /rejected the username or password/);
      assert.match(error.message, /Username: user/);
      assert.match(error.message, /Database: transportcheck/);
      return true;
    }
  );
} finally {
  globalThis.fetch = originalUnauthorizedFetch;
}

const originalSecurityFetch = globalThis.fetch;
const securityRequests = [];
globalThis.fetch = async (url, options) => {
  securityRequests.push({
    url,
    method: options.method,
    body: options.body ? JSON.parse(options.body) : undefined
  });
  if (options.method === "GET") {
    return new Response(JSON.stringify({ admins: { names: [], roles: [] }, members: { names: [], roles: [] } }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
};

try {
  const security = await createClient(false).secureDatabaseForCurrentUser();
  assert.deepEqual(securityRequests.map((request) => request.method), ["GET", "PUT", "GET"]);
  assert.equal(securityRequests[0].url, "http://example.invalid:5984/transportcheck/_security");
  assert.equal(securityRequests[1].url, "http://example.invalid:5984/transportcheck/_security");
  assert.deepEqual(securityRequests[1].body.admins.names, ["user"]);
  assert.deepEqual(securityRequests[1].body.members.names, ["user"]);
  assert.deepEqual(security.admins.names, []);
} finally {
  globalThis.fetch = originalSecurityFetch;
}

console.log(JSON.stringify({
  ok: true,
  defaultFetchTransport: fetchCalls === 1,
  addressUnreachableGuidance: true,
  timeoutGuidance: true,
  unauthorizedGuidance: true,
  shortenedTimeouts,
  databaseSecurityRequests: securityRequests.length
}, null, 2));
