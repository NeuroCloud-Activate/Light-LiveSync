import assert from "node:assert/strict";
import {
  RUNTIME_EVIDENCE_FOLDER,
  formatRuntimeEvidenceReport,
  runtimeEvidenceReportFileName,
  runtimeEvidenceReportPath
} from "../src/runtime-evidence-report.ts";
import { DEFAULT_SETTINGS } from "../src/settings.ts";

const settings = {
  ...JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
  configured: true,
  couchDb: {
    ...JSON.parse(JSON.stringify(DEFAULT_SETTINGS.couchDb)),
    uri: "http://private.example:5984",
    database: "secretvault",
    username: "private-user",
    password: "private-password"
  },
  passphrase: "private-passphrase",
  runtime: {
    ...JSON.parse(JSON.stringify(DEFAULT_SETTINGS.runtime)),
    lastSyncReason: "vault-change",
    lastSyncStartedAt: 1780362500000,
    lastSyncFinishedAt: 1780362500150,
    lastSyncDurationMs: 150,
    lastSyncOk: true,
    lastSyncMessage: "Pushed 1. Pulled 2. Applied 1. Pending apply: 0.",
    syncsStarted: 3,
    syncsFinished: 3,
    syncsFailed: 0,
    lastSyncMetrics: {
      ...JSON.parse(JSON.stringify(DEFAULT_SETTINGS.runtime.lastSyncMetrics)),
      pushedFiles: 1,
      pulledChanges: 2,
      appliedFiles: 1,
      remoteDocsWritten: 2,
      localBytesRead: 123,
      chunkDocsBuilt: 1,
      inspectMs: 10,
      pushMs: 90,
      pullMs: 20,
      applyMs: 5
    }
  }
};

const report = formatRuntimeEvidenceReport({
  generatedAt: 1780362600000,
  platform: "iPhone; 5 touch points",
  manifest: {
    id: "lightweight-livesync",
    version: "0.1.0",
    isDesktopOnly: false
  },
  settings,
  capability: {
    ok: true,
    message: "Runtime capability check passed.",
    details: ["Manifest allows desktop and mobile.", "IndexedDB is usable for local queues."]
  },
  smoke: {
    ok: true,
    message: "Runtime check passed.",
    details: ["Desktop and mobile manifest.", "Queues: 0 local changes waiting; 0 remote files waiting."]
  }
});

assert.match(report, /# Lightweight LiveSync Runtime Evidence/);
assert.match(report, /Platform: iPhone; 5 touch points/);
assert.match(report, /Capability check: pass/);
assert.match(report, /Runtime smoke check: pass/);
assert.match(report, /Syncs finished: 3/);
assert.match(report, /Phase timings inspect\/push\/pull\/apply: 10\/90\/20\/5ms/);
assert.match(report, /This report intentionally excludes/);
assert.doesNotMatch(report, /private\.example/);
assert.doesNotMatch(report, /secretvault/);
assert.doesNotMatch(report, /private-user/);
assert.doesNotMatch(report, /private-password/);
assert.doesNotMatch(report, /private-passphrase/);

const fileName = runtimeEvidenceReportFileName(1780362600123);
const filePath = runtimeEvidenceReportPath(1780362600123);
assert.equal(RUNTIME_EVIDENCE_FOLDER, "Lightweight LiveSync Evidence");
assert.equal(fileName, "runtime-evidence-2026-06-02T01-10-00-123Z.md");
assert.equal(filePath, "Lightweight LiveSync Evidence/runtime-evidence-2026-06-02T01-10-00-123Z.md");
assert.doesNotMatch(fileName, /:/);
assert.doesNotMatch(fileName.replace(/\.md$/, ""), /\./);

console.log(JSON.stringify({
  ok: true,
  excludesSecrets: true,
  includesRuntimeCounters: true,
  includesWorkload: true,
  safeReportPath: true
}, null, 2));
