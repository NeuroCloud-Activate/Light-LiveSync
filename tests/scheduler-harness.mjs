#!/usr/bin/env node

import assert from "node:assert/strict";

globalThis.window = {
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: (timer) => clearTimeout(timer)
};

const { SyncScheduler } = await import("../src/scheduler.ts");

const starts = [];
const finishes = [];
const statuses = [];
const logs = [];
let syncCalls = 0;

const scheduler = new SyncScheduler(
  {
    async sync(reason) {
      syncCalls += 1;
      if (reason === "manual") {
        return { ok: true, message: "Manual sync ok." };
      }
      throw new Error("offline");
    }
  },
  {
    getMinimumIntervalMs: () => 0,
    log: (message) => logs.push(message),
    setStatus: (message) => statuses.push(message),
    onSyncStart: (reason, startedAt) => starts.push({ reason, startedAt }),
    onSyncFinish: (details) => finishes.push(details)
  }
);

scheduler.request("manual", true);
await new Promise((resolve) => setTimeout(resolve, 20));
scheduler.request("periodic", true);
await new Promise((resolve) => setTimeout(resolve, 20));

assert.equal(syncCalls, 2);
assert.deepEqual(starts.map((item) => item.reason), ["manual", "periodic"]);
assert.equal(finishes[0].result.ok, true);
assert.equal(finishes[0].result.message, "Manual sync ok.");
assert.equal(finishes[1].errorMessage, "offline");
assert.equal(finishes.every((item) => item.finishedAt >= item.startedAt), true);
assert.equal(statuses.includes("Manual sync ok."), true);
assert.equal(logs.includes("Sync failed: offline"), true);

const cooldownStarts = [];
let cooldownSyncCalls = 0;
const cooldownScheduler = new SyncScheduler(
  {
    async sync(reason) {
      cooldownSyncCalls += 1;
      cooldownStarts.push({ reason, at: Date.now() });
      if (reason === "manual") {
        return { ok: true, message: "Manual cooldown bypass ok." };
      }
      throw new Error("offline");
    }
  },
  {
    getMinimumIntervalMs: () => 0,
    getFailureCooldownMs: () => 40,
    log: () => {},
    setStatus: () => {}
  }
);

const cooldownStartedAt = Date.now();
cooldownScheduler.request("periodic", true);
await new Promise((resolve) => setTimeout(resolve, 10));
cooldownScheduler.request("vault-change");
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(cooldownSyncCalls, 1);
await new Promise((resolve) => setTimeout(resolve, 40));
assert.equal(cooldownSyncCalls, 2);
assert.equal(cooldownStarts[1].reason, "vault-change");
assert.ok(cooldownStarts[1].at >= cooldownStartedAt + 40);

cooldownScheduler.request("periodic", true);
await new Promise((resolve) => setTimeout(resolve, 10));
cooldownScheduler.request("manual", true);
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(cooldownStarts.at(-1).reason, "manual");

console.log(JSON.stringify({
  ok: true,
  starts: starts.length,
  finishes: finishes.length,
  capturedFailure: finishes[1].errorMessage,
  automaticCooldown: true,
  manualBypass: true
}, null, 2));
