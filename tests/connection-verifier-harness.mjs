import assert from "node:assert/strict";
import { verifyCouchDbConnection } from "../src/connection-verifier.ts";

const calls = [];

const created = await verifyCouchDbConnection({
  async ensureDatabase() {
    calls.push("ensureDatabase");
    return {
      created: true,
      info: { db_name: "createddb", doc_count: 0, update_seq: "0" }
    };
  },
  async secureDatabaseForCurrentUser() {
    calls.push("secureDatabaseForCurrentUser");
    return {
      admins: { names: ["user"], roles: [] },
      members: { names: ["user"], roles: [] }
    };
  },
  async ensureSyncParameters() {
    calls.push("ensureSyncParameters");
    return {
      created: true,
      parameters: {
        _id: "_local/obsidian_livesync_sync_parameters",
        type: "sync-parameters",
        protocolVersion: 2,
        pbkdf2salt: "salt"
      }
    };
  },
  async inspect() {
    calls.push("inspect");
    return {
      serverVersion: "3.4.2",
      databaseName: "createddb",
      documentCount: 1,
      updateSequence: "1",
      syncParametersPresent: true,
      syncParameterSalt: "salt",
      milestonePresent: false,
      sample: {
        total: 0,
        notes: 0,
        chunks: 0,
        system: 0,
        deleted: 0,
        unknown: 0
      }
    };
  }
});

const reused = await verifyCouchDbConnection({
  async ensureDatabase() {
    calls.push("ensureExistingDatabase");
    return {
      created: false,
      info: { db_name: "existingdb", doc_count: 3, update_seq: "4" }
    };
  },
  async secureDatabaseForCurrentUser() {
    calls.push("secureExistingDatabaseForCurrentUser");
    return {
      admins: { names: ["user"], roles: [] },
      members: { names: ["user"], roles: [] }
    };
  },
  async ensureSyncParameters() {
    calls.push("ensureExistingSyncParameters");
    return {
      created: false,
      parameters: {
        _id: "_local/obsidian_livesync_sync_parameters",
        type: "sync-parameters",
        protocolVersion: 2,
        pbkdf2salt: "salt"
      }
    };
  },
  async inspect() {
    calls.push("inspectExisting");
    return {
      serverVersion: "3.4.2",
      databaseName: "existingdb",
      documentCount: 3,
      updateSequence: "4",
      syncParametersPresent: true,
      syncParameterSalt: "salt",
      milestonePresent: false,
      sample: {
        total: 0,
        notes: 0,
        chunks: 0,
        system: 0,
        deleted: 0,
        unknown: 0
      }
    };
  }
});

const readOnlyCalls = [];
const readOnlyExisting = await verifyCouchDbConnection({
  async getDatabaseInfo() {
    readOnlyCalls.push("getDatabaseInfo");
    return { db_name: "existingdb", doc_count: 3, update_seq: "4" };
  },
  async ensureDatabase() {
    readOnlyCalls.push("ensureDatabase");
    throw new Error("Read-only verification must not create a database.");
  },
  async ensureSyncParameters() {
    readOnlyCalls.push("ensureSyncParameters");
    throw new Error("Read-only verification must not create sync parameters.");
  },
  async inspect() {
    readOnlyCalls.push("inspect");
    return {
      serverVersion: "3.4.2",
      databaseName: "existingdb",
      documentCount: 3,
      updateSequence: "4",
      syncParametersPresent: true,
      syncParameterSalt: "salt",
      milestonePresent: false,
      sample: {
        total: 0,
        notes: 0,
        chunks: 0,
        system: 0,
        deleted: 0,
        unknown: 0
      }
    };
  }
}, {
  allowDatabaseCreation: false,
  allowSyncParameterCreation: false
});

const readOnlyMissingParameters = await verifyCouchDbConnection({
  async getDatabaseInfo() {
    return { db_name: "missingparams", doc_count: 0, update_seq: "0" };
  },
  async ensureDatabase() {
    throw new Error("Read-only verification must not create a database.");
  },
  async ensureSyncParameters() {
    throw new Error("Read-only verification must not create sync parameters.");
  },
  async inspect() {
    return {
      serverVersion: "3.4.2",
      databaseName: "missingparams",
      documentCount: 0,
      updateSequence: "0",
      syncParametersPresent: false,
      syncParameterSalt: "",
      milestonePresent: false,
      sample: {
        total: 0,
        notes: 0,
        chunks: 0,
        system: 0,
        deleted: 0,
        unknown: 0
      }
    };
  }
}, {
  allowDatabaseCreation: false,
  allowSyncParameterCreation: false
});

assert.deepEqual(calls, [
  "ensureDatabase",
  "secureDatabaseForCurrentUser",
  "ensureSyncParameters",
  "inspect",
  "ensureExistingDatabase",
  "secureExistingDatabaseForCurrentUser",
  "ensureExistingSyncParameters",
  "inspectExisting"
]);
assert.equal(created.databaseMessage, "created");
assert.equal(created.securityMessage, "database access restricted to this CouchDB user");
assert.equal(created.syncParametersMessage, "sync parameters created");
assert.match(created.statusMessage, /CouchDB created; database access restricted; sync parameters created/);
assert.match(created.noticeMessage, /credentials verified/);
assert.match(created.noticeMessage, /database access restricted/);
assert.equal(created.inspection.databaseName, "createddb");

assert.equal(reused.databaseMessage, "found and ready");
assert.equal(reused.securityMessage, "database access restricted to this CouchDB user");
assert.equal(reused.syncParametersMessage, "sync parameters ready");
assert.match(reused.statusMessage, /CouchDB found and ready; database access restricted; sync parameters ready/);
assert.equal(reused.inspection.databaseName, "existingdb");
assert.deepEqual(readOnlyCalls, ["getDatabaseInfo", "inspect"]);
assert.equal(readOnlyExisting.databaseMessage, "found and ready");
assert.equal(readOnlyExisting.syncParametersMessage, "sync parameters ready");
assert.match(readOnlyExisting.statusMessage, /CouchDB found and ready; sync parameters ready/);
assert.equal(readOnlyMissingParameters.syncParametersMessage, "sync parameters missing; initialize them from the original device");
assert.match(readOnlyMissingParameters.noticeMessage, /original device/);

console.log(JSON.stringify({
  ok: true,
  createdMessage: created.noticeMessage,
  reusedMessage: reused.noticeMessage,
  readOnlyMessage: readOnlyExisting.noticeMessage,
  readOnlyMissingParameters: readOnlyMissingParameters.noticeMessage,
  callOrder: calls,
  readOnlyCallOrder: readOnlyCalls
}, null, 2));
