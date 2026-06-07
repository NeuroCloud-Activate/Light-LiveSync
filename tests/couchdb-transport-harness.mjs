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

const originalInspectFetch = globalThis.fetch;
const inspectRequests = [];
globalThis.fetch = async (url, options) => {
  inspectRequests.push({ url, method: options.method });
  if (url === "http://example.invalid:5984") {
    return new Response(JSON.stringify({ version: "3.3.0" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
  if (url === "http://example.invalid:5984/transportcheck") {
    return new Response(JSON.stringify({ db_name: "transportcheck", doc_count: 4, update_seq: "checkpoint-123" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
  if (url === "http://example.invalid:5984/transportcheck/_local/obsidian_livesync_sync_parameters") {
    return new Response(JSON.stringify({ _id: "_local/obsidian_livesync_sync_parameters", type: "sync-parameters", pbkdf2salt: "salt" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
  if (url === "http://example.invalid:5984/transportcheck/_local/obsydian_livesync_milestone") {
    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  }
  if (url === "http://example.invalid:5984/transportcheck/_changes?include_docs=true&limit=50&descending=true") {
    return new Response(JSON.stringify({
      results: [
        { id: "notes/example.md", seq: "checkpoint-123", doc: { _id: "notes/example.md", type: "plain", path: "notes/example.md" } }
      ]
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
  if (url === "http://example.invalid:5984/transportcheck/_changes?include_docs=true&limit=37&since=checkpoint-123") {
    return new Response(JSON.stringify({
      last_seq: "checkpoint-124",
      results: [
        { id: "notes/changed.md", seq: "checkpoint-124", doc: { _id: "notes/changed.md", type: "plain", path: "notes/changed.md" } }
      ]
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
  throw new Error(`Unexpected request ${options.method} ${url}`);
};

let metadataOnlyInspection;
let sampledInspection;
let checkpointPull;
try {
  const client = createClient(false);
  metadataOnlyInspection = await client.inspect();
  sampledInspection = await client.inspect({ includeRecentChangesSample: true });
  checkpointPull = await client.getChangesSince("checkpoint-123", 37);
} finally {
  globalThis.fetch = originalInspectFetch;
}

assert.equal(metadataOnlyInspection.recentChangesSampled, false);
assert.equal(metadataOnlyInspection.sample.total, 0);
assert.equal(sampledInspection.recentChangesSampled, true);
assert.equal(sampledInspection.sample.notes, 1);
assert.equal(checkpointPull.lastSeq, "checkpoint-124");
assert.equal(checkpointPull.changes.length, 1);
assert.equal(
  inspectRequests.filter((request) => request.url.includes("_changes?include_docs=true&limit=50&descending=true")).length,
  1
);
assert.equal(
  inspectRequests.filter((request) => request.url.includes("_changes?include_docs=true&limit=37&since=checkpoint-123")).length,
  1
);

console.log(JSON.stringify({
  ok: true,
  defaultFetchTransport: fetchCalls === 1,
  addressUnreachableGuidance: true,
  timeoutGuidance: true,
  unauthorizedGuidance: true,
  shortenedTimeouts,
  databaseSecurityRequests: securityRequests.length,
  metadataOnlyInspectSkipsRecentChanges: !metadataOnlyInspection.recentChangesSampled,
  checkpointPullUsesSince: checkpointPull.lastSeq === "checkpoint-124"
}, null, 2));
