import type { RuntimeCapabilityReport } from "./runtime-capabilities";
import type { RuntimeSmokeCheckReport, RuntimeSmokeManifest } from "./runtime-smoke-check";
import type { LightweightLiveSyncSettings } from "./settings";

export type RuntimeEvidenceReportInput = {
  generatedAt: number;
  platform: string;
  manifest: RuntimeSmokeManifest;
  settings: LightweightLiveSyncSettings;
  smoke: RuntimeSmokeCheckReport;
  capability: RuntimeCapabilityReport;
};

export const RUNTIME_EVIDENCE_FOLDER = "Lightweight LiveSync Evidence";

function checkbox(ok: boolean): string {
  return ok ? "pass" : "needs attention";
}

function isoTime(value: number): string {
  return value > 0 ? new Date(value).toISOString() : "not recorded";
}

function lineItems(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

export function runtimeEvidenceReportFileName(generatedAt: number): string {
  return `runtime-evidence-${new Date(generatedAt).toISOString().replace(/[:.]/g, "-")}.md`;
}

export function runtimeEvidenceReportPath(generatedAt: number): string {
  return `${RUNTIME_EVIDENCE_FOLDER}/${runtimeEvidenceReportFileName(generatedAt)}`;
}

export function formatRuntimeEvidenceReport(input: RuntimeEvidenceReportInput): string {
  const { capability, generatedAt, manifest, platform, settings, smoke } = input;
  const runtime = settings.runtime;
  const queue = settings.localQueue;
  const metrics = runtime.lastSyncMetrics;

  return [
    "# Lightweight LiveSync Runtime Evidence",
    "",
    `Generated: ${new Date(generatedAt).toISOString()}`,
    `Platform: ${platform || "unknown"}`,
    `Plugin: ${manifest.id} ${manifest.version}`,
    `Manifest: ${manifest.isDesktopOnly ? "desktop-only" : "desktop and mobile"}`,
    "",
    "This report intentionally excludes CouchDB hostnames, database names, usernames, passwords, E2EE passphrases, setup URIs, and local filesystem paths.",
    "",
    "## Result",
    "",
    `- Capability check: ${checkbox(capability.ok)}`,
    `- Runtime smoke check: ${checkbox(smoke.ok)}`,
    `- Last sync result: ${runtime.lastSyncOk ? "pass" : "needs attention"}`,
    `- Pending local pushes: ${queue.pendingPush}`,
    `- Pending remote applies: ${queue.pendingApply}`,
    `- Sync failures recorded: ${runtime.syncsFailed}`,
    "",
    "## Runtime Counters",
    "",
    `- Syncs started: ${runtime.syncsStarted}`,
    `- Syncs finished: ${runtime.syncsFinished}`,
    `- Last reason: ${runtime.lastSyncReason || "none"}`,
    `- Last started: ${isoTime(runtime.lastSyncStartedAt)}`,
    `- Last finished: ${isoTime(runtime.lastSyncFinishedAt)}`,
    `- Last duration: ${runtime.lastSyncDurationMs}ms`,
    `- Last message: ${runtime.lastSyncMessage || "none"}`,
    `- Last issue: ${runtime.lastSyncError || "none"}`,
    "",
    "## Last Workload",
    "",
    `- Pushed files: ${metrics.pushedFiles}`,
    `- Deleted files: ${metrics.deletedFiles}`,
    `- Skipped files: ${metrics.skippedFiles}`,
    `- Failed files: ${metrics.failedFiles}`,
    `- Pulled changes: ${metrics.pulledChanges}`,
    `- Applied files: ${metrics.appliedFiles}`,
    `- Merged files: ${metrics.mergedFiles}`,
    `- Recovery backups: ${metrics.backedUpFiles}`,
    `- Conflicts: ${metrics.conflictedFiles}`,
    `- Remote documents written: ${metrics.remoteDocsWritten}`,
    `- Remote documents reused: ${metrics.remoteDocsReused}`,
    `- Remote document conflicts: ${metrics.remoteDocsConflicts}`,
    `- Local bytes read: ${metrics.localBytesRead}`,
    `- Chunk documents built: ${metrics.chunkDocsBuilt}`,
    `- Phase timings inspect/push/pull/apply: ${metrics.inspectMs}/${metrics.pushMs}/${metrics.pullMs}/${metrics.applyMs}ms`,
    "",
    "## Capability Details",
    "",
    capability.message,
    "",
    lineItems(capability.details),
    "",
    "## Runtime Details",
    "",
    smoke.message,
    "",
    lineItems(smoke.details),
    ""
  ].join("\n");
}
