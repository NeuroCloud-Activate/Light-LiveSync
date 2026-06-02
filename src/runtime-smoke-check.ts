import { credentialsAreLocked, type LightweightLiveSyncSettings } from "./settings";

export type RuntimeSmokeManifest = {
  id: string;
  version: string;
  isDesktopOnly?: boolean;
};

export type RuntimeSmokeCheckInput = {
  manifest: RuntimeSmokeManifest;
  settings: LightweightLiveSyncSettings;
  workerScriptAvailable: boolean;
};

export type RuntimeSmokeCheckReport = {
  ok: boolean;
  message: string;
  details: string[];
};

export function buildRuntimeSmokeCheckReport(input: RuntimeSmokeCheckInput): RuntimeSmokeCheckReport {
  const { manifest, settings } = input;
  const issues: string[] = [];
  const metrics = settings.runtime.lastSyncMetrics;
  const details = [
    `Plugin ${manifest.id} ${manifest.version}.`,
    manifest.isDesktopOnly ? "Desktop-only manifest." : "Desktop and mobile manifest.",
    `Transport: ${settings.couchDb.useRequestApi ? "Obsidian request API" : "standard fetch"}.`,
    input.workerScriptAvailable ? "Background worker path is available." : "Background worker path is unavailable; main-thread fallback will be used.",
    settings.configured ? "CouchDB setup is saved." : "CouchDB setup is not saved yet.",
    settings.deviceSetupRole === "additional-device"
      ? "Device role: additional device; connection checks verify the existing remote only."
      : "Device role: initial device; connection checks may create or initialize the remote.",
    settings.keepUnlockedDuringSession
      ? "Session unlock cache is enabled for renderer-refresh recovery."
      : "Session unlock cache is disabled; unlock is memory-only.",
    settings.autoApplyPull ? "Automatic remote apply is enabled." : "Automatic remote apply is disabled.",
    settings.conflictFolder
      ? "Recovery backups use a custom conflict folder."
      : "Recovery backups use the default plugin conflict folder.",
    "Text differences are merged automatically before remote changes are marked applied.",
    settings.remoteState.lastCheckedAt > 0
      ? `Remote checked; sync parameters ${settings.remoteState.syncParametersPresent ? "ready" : "not ready"}.`
      : "Remote has not been checked in this session.",
    `Queues: ${settings.localQueue.pendingPush} local change${settings.localQueue.pendingPush === 1 ? "" : "s"} waiting; ${settings.localQueue.pendingApply} remote file${settings.localQueue.pendingApply === 1 ? "" : "s"} waiting.`,
    `Last workload: pushed ${metrics.pushedFiles}, pulled ${metrics.pulledChanges}, applied ${metrics.appliedFiles + metrics.mergedFiles}; upload read ${metrics.localBytesRead} bytes; phases inspect/push/pull/apply ${metrics.inspectMs}/${metrics.pushMs}/${metrics.pullMs}/${metrics.applyMs}ms.`
  ];

  if (manifest.isDesktopOnly) {
    issues.push("manifest is desktop-only");
  }
  if (!settings.configured) {
    issues.push("CouchDB setup is missing");
  }
  if (credentialsAreLocked(settings)) {
    issues.push("credentials are locked");
  }
  if (settings.requireE2EE && !settings.passphrase) {
    issues.push("E2EE passphrase is not unlocked");
  }
  if (!settings.autoApplyPull) {
    issues.push("automatic remote apply is disabled");
  }
  if (settings.remoteState.lastCheckedAt > 0 && !settings.remoteState.syncParametersPresent) {
    issues.push("remote sync parameters are missing");
  }

  if (issues.length === 0) {
    return {
      ok: true,
      message: "Runtime check passed. Lightweight LiveSync is loaded and ready for background sync.",
      details
    };
  }

  return {
    ok: false,
    message: `Runtime check needs attention: ${issues.join(", ")}.`,
    details
  };
}
