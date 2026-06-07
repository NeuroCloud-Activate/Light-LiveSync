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

cooldownScheduler.request("periodic", true);
await new Promise((resolve) => setTimeout(resolve, 10));
cooldownScheduler.request("vault-change");
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(cooldownSyncCalls, 1);
await new Promise((resolve) => setTimeout(resolve, 40));
assert.equal(cooldownSyncCalls, 2);
assert.equal(cooldownStarts[1].reason, "vault-change");

cooldownScheduler.request("periodic", true);
await new Promise((resolve) => setTimeout(resolve, 10));
cooldownScheduler.request("manual", true);
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(cooldownStarts.at(-1).reason, "manual");

const continueLogs = [];
let continuationCalls = 0;
const continuationScheduler = new SyncScheduler(
  {
    async sync() {
      continuationCalls += 1;
      return continuationCalls === 1
        ? { ok: true, message: "First pass needs more work.", continueSync: true }
        : { ok: true, message: "Second pass done." };
    }
  },
  {
    getMinimumIntervalMs: () => 1000,
    log: (message) => continueLogs.push(message),
    setStatus: () => {}
  }
);

continuationScheduler.request("manual", true);
await new Promise((resolve) => setTimeout(resolve, 30));
assert.equal(continuationCalls, 2);
assert.match(continueLogs.join(" "), /continue with another sync pass/);

const preemptedReasons = [];
const preemptScheduler = new SyncScheduler(
  {
    async sync(reason) {
      preemptedReasons.push(reason);
      return { ok: true, message: `${reason} ok.` };
    }
  },
  {
    getMinimumIntervalMs: (reason) => reason === "periodic" ? 1000 : 0,
    log: () => {},
    setStatus: () => {}
  }
);
preemptScheduler.request("manual", true);
await new Promise((resolve) => setTimeout(resolve, 20));
preemptScheduler.request("periodic");
await new Promise((resolve) => setTimeout(resolve, 20));
preemptScheduler.request("startup", true);
await new Promise((resolve) => setTimeout(resolve, 30));
assert.deepEqual(preemptedReasons, ["manual", "startup"]);

const minimumIntervalReasons = [];
const reasonAwareScheduler = new SyncScheduler(
  {
    async sync() {
      return { ok: true, message: "Reason-aware sync ok." };
    }
  },
  {
    getMinimumIntervalMs: (reason) => {
      minimumIntervalReasons.push(reason);
      return reason === "periodic" ? 15 : 0;
    },
    log: () => {},
    setStatus: () => {}
  }
);
reasonAwareScheduler.request("manual", true);
await new Promise((resolve) => setTimeout(resolve, 10));
reasonAwareScheduler.request("periodic");
await new Promise((resolve) => setTimeout(resolve, 25));
assert.deepEqual(minimumIntervalReasons, ["periodic"]);

console.log(JSON.stringify({
  ok: true,
  starts: starts.length,
  finishes: finishes.length,
  capturedFailure: finishes[1].errorMessage,
  automaticCooldown: true,
  manualBypass: true,
  automaticContinuation: true,
  immediatePreemptsDelayed: true,
  reasonAwareMinimum: true
}, null, 2));
