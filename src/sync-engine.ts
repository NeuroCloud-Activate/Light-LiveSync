import { CouchDbClient, type RemoteInspection } from "./couchdb-client";
import { pathToLiveSyncDocumentId, type LiveSyncBuildOptions, type LiveSyncPushBundle, type LocalFileSnapshot } from "./livesync-document-builder";
import type { LocalDocumentStore, LocalStoreSummary } from "./local-document-store";
import { writeVersionForFile } from "./version-history";
import {
  DEFAULT_RUNTIME_SYNC_METRICS,
  credentialsAreLocked,
  hasUsableRemote,
  type LightweightLiveSyncSettings,
  type RuntimeSyncMetricsState
} from "./settings";

export type SyncReason =
  | "manual"
  | "startup"
  | "periodic"
  | "vault-change"
  | "setup-import"
  | "setup-qr-import";

export type SyncOutcome =
  | {
      ok: true;
      message: string;
      metrics?: RuntimeSyncMetricsState;
      continueSync?: boolean;
    }
  | {
      ok: false;
      message: string;
      metrics?: RuntimeSyncMetricsState;
    };

export type AutoApplyOutcome = {
  applied: number;
  deleted: number;
  skipped: number;
  waiting: number;
  merged: number;
  backedUp: number;
  conflicted: number;
  failed: number;
};

export type SyncProgress =
  | {
      phase: "inspect-start";
      reason: SyncReason;
    }
  | {
      phase: "inspect-complete";
      databaseName: string;
      documentCount: number;
    }
  | {
      phase: "push-start";
      total: number;
    }
  | {
      phase: "push-file-start";
      completed: number;
      total: number;
      path: string;
    }
  | {
      phase: "push-file-complete";
      completed: number;
      total: number;
      path: string;
      pushed: number;
      deleted: number;
      skipped: number;
      failed: number;
      bytes: number;
      startedAt: number;
    }
  | {
      phase: "push-complete";
      total: number;
      pushed: number;
      deleted: number;
      skipped: number;
      failed: number;
      bytes: number;
      startedAt: number;
    }
  | {
      phase: "pull-start";
      since: string;
    }
  | {
      phase: "pull-batch";
      completed: number;
      total: number;
      bytes: number;
      startedAt: number;
    }
  | {
      phase: "pull-complete";
      total: number;
      bytes: number;
      startedAt: number;
      since: string;
      lastSeq: string;
    }
  | {
      phase: "apply-start";
      pending: number;
    };

export type SyncRemoteClient = Pick<
  CouchDbClient,
  | "ensureDatabase"
  | "ensureSyncParameters"
  | "inspect"
  | "getChangesSince"
  | "getDocumentsByIds"
  | "deleteLiveSyncDocument"
  | "putLiveSyncBundle"
  | "putLiveSyncBundles"
  | "getVersionDocumentsForFile"
  | "putVersionDocument"
  | "deleteDocuments"
>;

type PushBatchOutcome = {
  pushed: number;
  deleted: number;
  skipped: number;
  failed: number;
  remoteDocsWritten: number;
  remoteDocsReused: number;
  remoteDocsConflicts: number;
  localBytesRead: number;
  chunkDocsBuilt: number;
  versionsSaved: number;
  versionsSkipped: number;
  versionsPruned: number;
  versionsFailed: number;
};

type PreparedPush = {
  path: string;
  previousAttempts: number;
  fingerprint: string;
  bundle: LiveSyncPushBundle;
  localBytesRead: number;
  chunkDocsBuilt: number;
};

export type LocalFileInfo = {
  path: string;
  ctime: number;
  mtime: number;
  size: number;
  contentType: "text" | "binary";
};

type ReadySyncSettings = {
  ok: true;
  settings: LightweightLiveSyncSettings;
};

type NotReadySyncSettings = Extract<SyncOutcome, { ok: false }>;

type PulledRemoteChanges = {
  pulledCount: number;
  summary: LocalStoreSummary;
  lastSeq: string;
  reachedRemoteEnd: boolean;
};

const REMOTE_PULL_LIMIT = 250;
const REMOTE_CACHE_BATCH_SIZE = 50;
const AUTOMATIC_FULL_VAULT_SCAN_REASONS = new Set<SyncReason>([
  "startup",
  "periodic",
  "setup-import",
  "setup-qr-import"
]);

function failedPushRetryDelayMs(settings: LightweightLiveSyncSettings, attemptsAfterFailure: number): number {
  const baseMs = Math.max(5, settings.failedPushRetryBaseSec) * 1000;
  const maxMs = Math.max(baseMs, settings.failedPushRetryMaxSec * 1000);
  const multiplier = 2 ** Math.min(8, Math.max(0, attemptsAfterFailure - 1));
  return Math.min(maxMs, baseMs * multiplier);
}

function emptySyncMetrics(): RuntimeSyncMetricsState {
  return { ...DEFAULT_RUNTIME_SYNC_METRICS };
}

function emptyPushOutcome(): PushBatchOutcome {
  return {
    pushed: 0,
    deleted: 0,
    skipped: 0,
    failed: 0,
    remoteDocsWritten: 0,
    remoteDocsReused: 0,
    remoteDocsConflicts: 0,
    localBytesRead: 0,
    chunkDocsBuilt: 0,
    versionsSaved: 0,
    versionsSkipped: 0,
    versionsPruned: 0,
    versionsFailed: 0
  };
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function localSnapshotContentType(snapshot: LocalFileSnapshot): LocalFileInfo["contentType"] {
  return typeof snapshot.content === "string" ? "text" : "binary";
}

async function localSnapshotFingerprint(snapshot: LocalFileSnapshot): Promise<string> {
  const bytes = typeof snapshot.content === "string"
    ? new TextEncoder().encode(snapshot.content)
    : new Uint8Array(snapshot.content);
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  );
  return `v2:${localSnapshotContentType(snapshot)}:${snapshot.size}:${Math.trunc(snapshot.mtime)}:${bytesToHex(new Uint8Array(digest))}`;
}

type ParsedLocalFingerprint =
  | {
      version: "v2";
      contentType: LocalFileInfo["contentType"];
      size: number;
      mtime: number;
      hash: string;
    }
  | {
      version: "legacy";
      contentType: LocalFileInfo["contentType"];
      size: number;
      hash: string;
    };

function parseLocalPushFingerprint(value: string | undefined): ParsedLocalFingerprint | undefined {
  if (!value) {
    return undefined;
  }
  const parts = value.split(":");
  if (parts[0] === "v2" && parts.length === 5) {
    const contentType = parts[1] === "binary" ? "binary" : parts[1] === "text" ? "text" : undefined;
    const size = Number(parts[2]);
    const mtime = Number(parts[3]);
    const hash = parts[4];
    if (contentType && Number.isFinite(size) && Number.isFinite(mtime) && hash) {
      return { version: "v2", contentType, size, mtime, hash };
    }
  }
  if ((parts[0] === "text" || parts[0] === "binary") && parts.length === 3) {
    const size = Number(parts[1]);
    const hash = parts[2];
    if (Number.isFinite(size) && hash) {
      return { version: "legacy", contentType: parts[0], size, hash };
    }
  }
  return undefined;
}

export function localPushFingerprintMatchesFileInfo(fingerprint: string | undefined, info: LocalFileInfo | undefined): boolean {
  const parsed = parseLocalPushFingerprint(fingerprint);
  if (!parsed || parsed.version !== "v2" || !info) {
    return false;
  }
  return parsed.contentType === info.contentType &&
    parsed.size === info.size &&
    parsed.mtime === Math.trunc(info.mtime);
}

function fingerprintMatchesSnapshot(previous: string | undefined, next: string): boolean {
  const parsedPrevious = parseLocalPushFingerprint(previous);
  const parsedNext = parseLocalPushFingerprint(next);
  if (!parsedPrevious || !parsedNext) {
    return previous === next;
  }
  return parsedPrevious.contentType === parsedNext.contentType &&
    parsedPrevious.size === parsedNext.size &&
    parsedPrevious.hash === parsedNext.hash;
}

export type SyncEngineHost = {
  getSettings(): LightweightLiveSyncSettings;
  updateRemoteInspection(inspection: RemoteInspection): Promise<void>;
  updateLocalQueue(summary: LocalStoreSummary): Promise<void>;
  queueCurrentVaultForSync?(): Promise<LocalStoreSummary | undefined>;
  getLocalStore(databaseName: string): LocalDocumentStore;
  readLocalFileInfo?(path: string): Promise<LocalFileInfo | undefined>;
  readLocalFileSnapshot(path: string): Promise<LocalFileSnapshot | undefined>;
  buildLocalPushBundle(snapshot: LocalFileSnapshot, options: LiveSyncBuildOptions): Promise<LiveSyncPushBundle>;
  applyPulledChanges(databaseName: string, client?: SyncRemoteClient): Promise<AutoApplyOutcome>;
  createRemoteClient?(settings: LightweightLiveSyncSettings): SyncRemoteClient;
  isNetworkLikelyOnline?(): boolean;
  yieldToUi?(): Promise<void>;
  log(message: string): void;
  reportProgress?(progress: SyncProgress): void;
};

export class LightweightSyncEngine {
  private readonly host: SyncEngineHost;

  constructor(host: SyncEngineHost) {
    this.host = host;
  }

  async initialiseRemote(): Promise<SyncOutcome> {
    const settings = this.host.getSettings();
    if (!settings.configured || !hasUsableRemote(settings)) {
      return { ok: false, message: "Light-LiveSync is not configured." };
    }
    if (settings.deviceSetupRole === "additional-device") {
      return {
        ok: false,
        message: "This device was added by setup URI. Initialize the remote database from the original device instead."
      };
    }
    if (credentialsAreLocked(settings)) {
      return { ok: false, message: "Saved credentials could not be opened automatically. Update saved credentials once before syncing." };
    }
    if (settings.requireE2EE && (!settings.encrypt || !settings.passphrase)) {
      return { ok: false, message: "E2EE is required. Update saved credentials or import the vault E2EE passphrase before syncing." };
    }

    const client = this.createRemoteClient(settings);
    await client.ensureDatabase();
    const result = await client.ensureSyncParameters();
    const inspection = await client.inspect();
    await this.host.updateRemoteInspection(inspection);
    return {
      ok: true,
      message: result.created ? "Remote sync parameters initialised." : "Remote sync parameters already exist."
    };
  }

  async sync(reason: SyncReason): Promise<SyncOutcome> {
    const ready = this.readySyncSettings();
    if (!ready.ok) {
      return ready;
    }

    const settings = ready.settings;
    const metrics = emptySyncMetrics();
    if (reason !== "manual" && this.host.isNetworkLikelyOnline?.() === false) {
      return {
        ok: false,
        message: "Device appears offline. Automatic sync is paused until connectivity returns.",
        metrics
      };
    }

    const client = this.createRemoteClient(settings);
    const localStore = this.host.getLocalStore(settings.couchDb.database);
    const startingSummary = await localStore.getSummary();
    let activeSummary = startingSummary;
    const inspection = await this.inspectRemoteWhenNeeded(client, settings, reason, startingSummary, metrics);

    if (inspection) {
      if (!inspection.syncParametersPresent) {
        return {
          ok: true,
          message: `Remote reachable (${inspection.documentCount} docs). Sync parameters are not initialised yet.`,
          metrics
        };
      }
      await this.queueCurrentVaultForFirstAutomaticSync(reason, inspection, localStore);
      activeSummary = await localStore.getSummary();
    }

    const pushStartedAt = Date.now();
    const pushed = activeSummary.pendingPush > 0
      ? await this.pushLocalChanges(client, localStore, settings)
      : emptyPushOutcome();
    metrics.pushMs = elapsedMs(pushStartedAt);
    metrics.pushedFiles = pushed.pushed;
    metrics.deletedFiles = pushed.deleted;
    metrics.skippedFiles = pushed.skipped;
    metrics.failedFiles = pushed.failed;
    metrics.remoteDocsWritten = pushed.remoteDocsWritten;
    metrics.remoteDocsReused = pushed.remoteDocsReused;
    metrics.remoteDocsConflicts = pushed.remoteDocsConflicts;
    metrics.localBytesRead = pushed.localBytesRead;
    metrics.chunkDocsBuilt = pushed.chunkDocsBuilt;
    metrics.versionsSaved = pushed.versionsSaved;
    metrics.versionsSkipped = pushed.versionsSkipped;
    metrics.versionsPruned = pushed.versionsPruned;
    metrics.versionsFailed = pushed.versionsFailed;

    if (inspection && await this.skipPullAfterFirstUpload(client, localStore, inspection, pushed)) {
      const summary = await localStore.getSummary();
      await this.host.updateLocalQueue(summary);
      const pulled = { pulledCount: 0, summary, lastSeq: inspection.updateSequence, reachedRemoteEnd: true };
      this.logSyncResult(reason, inspection.databaseName, pushed, 0);
      return this.syncOutcomeMessage(pushed, pulled, metrics);
    }

    const summaryAfterPush = activeSummary.pendingPush > 0
      ? await localStore.getSummary()
      : activeSummary;
    const pullStartedAt = Date.now();
    let pulled = await this.pullRemoteChanges(client, localStore, inspection?.updateSequence ?? activeSummary.lastRemoteSeq, summaryAfterPush);
    metrics.pullMs = elapsedMs(pullStartedAt);
    metrics.pulledChanges = pulled.pulledCount;

    const applyStartedAt = Date.now();
    const applied = await this.maybeAutoApplyPull(settings, pulled.summary, client);
    metrics.applyMs = elapsedMs(applyStartedAt);
    if (applied) {
      metrics.appliedFiles = applied.applied;
      metrics.mergedFiles = applied.merged;
      metrics.backedUpFiles = applied.backedUp;
      metrics.conflictedFiles = applied.conflicted;
      pulled = {
        ...pulled,
        summary: await localStore.getSummary()
      };
      await this.host.updateLocalQueue(pulled.summary);
    }

    this.logSyncResult(reason, inspection?.databaseName ?? settings.couchDb.database, pushed, pulled.pulledCount, applied);
    return this.syncOutcomeMessage(pushed, pulled, metrics, applied);
  }

  private async inspectRemoteWhenNeeded(
    client: SyncRemoteClient,
    settings: LightweightLiveSyncSettings,
    reason: SyncReason,
    startingSummary: LocalStoreSummary,
    metrics: RuntimeSyncMetricsState
  ): Promise<RemoteInspection | undefined> {
    if (this.canUseLightweightPull(settings, reason, startingSummary)) {
      return undefined;
    }

    const inspectStartedAt = Date.now();
    this.host.reportProgress?.({ phase: "inspect-start", reason });
    const inspection = await client.inspect();
    metrics.inspectMs = elapsedMs(inspectStartedAt);
    await this.host.updateRemoteInspection(inspection);
    this.host.reportProgress?.({
      phase: "inspect-complete",
      databaseName: inspection.databaseName,
      documentCount: inspection.documentCount
    });
    return inspection;
  }

  private canUseLightweightPull(
    settings: LightweightLiveSyncSettings,
    reason: SyncReason,
    startingSummary: LocalStoreSummary
  ): boolean {
    const startupCatchUpHasCheckpoint = reason === "startup" && startingSummary.lastRemoteSeq !== "0";
    return (reason === "periodic" || startupCatchUpHasCheckpoint) &&
      startingSummary.pendingPush === 0 &&
      !!settings.remoteState.syncParameterSalt;
  }

  private readySyncSettings(): ReadySyncSettings | NotReadySyncSettings {
    const settings = this.host.getSettings();
    if (!settings.configured || !hasUsableRemote(settings)) {
      return { ok: false, message: "Light-LiveSync is not configured." };
    }
    if (credentialsAreLocked(settings)) {
      return { ok: false, message: "Saved credentials could not be opened automatically. Update saved credentials once before syncing." };
    }
    if (settings.requireE2EE && (!settings.encrypt || !settings.passphrase)) {
      return { ok: false, message: "E2EE is required. Update saved credentials or import the vault E2EE passphrase before syncing." };
    }
    return { ok: true, settings };
  }

  private async pullRemoteChanges(
    client: SyncRemoteClient,
    localStore: LocalDocumentStore,
    remoteEndSeq: string,
    knownSummary?: LocalStoreSummary
  ): Promise<PulledRemoteChanges> {
    const checkpoint = await localStore.getCheckpoint();
    this.host.reportProgress?.({ phase: "pull-start", since: checkpoint.lastRemoteSeq });
    const pullStartedAt = Date.now();
    const pulled = await client.getChangesSince(checkpoint.lastRemoteSeq, REMOTE_PULL_LIMIT);
    let summary = knownSummary ?? await localStore.getSummary();
    let pulledBytes = 0;
    for (let index = 0; index < pulled.changes.length; index += REMOTE_CACHE_BATCH_SIZE) {
      const batch = pulled.changes.slice(index, index + REMOTE_CACHE_BATCH_SIZE);
      const isFinalBatch = index + batch.length >= pulled.changes.length;
      await this.host.yieldToUi?.();
      if (isFinalBatch) {
        summary = await localStore.cacheRemoteChanges(batch);
      } else if (typeof (localStore as { cacheRemoteChangesOnly?: (changes: Parameters<LocalDocumentStore["cacheRemoteChanges"]>[0]) => Promise<void> }).cacheRemoteChangesOnly === "function") {
        await (localStore as { cacheRemoteChangesOnly(changes: Parameters<LocalDocumentStore["cacheRemoteChanges"]>[0]): Promise<void> }).cacheRemoteChangesOnly(batch);
      } else {
        summary = await localStore.cacheRemoteChanges(batch);
      }
      pulledBytes += estimatedJsonBytes(batch);
      this.host.reportProgress?.({
        phase: "pull-batch",
        completed: Math.min(index + batch.length, pulled.changes.length),
        total: pulled.changes.length,
        bytes: pulledBytes,
        startedAt: pullStartedAt
      });
      await this.host.yieldToUi?.();
    }
    if (pulled.lastSeq !== checkpoint.lastRemoteSeq) {
      await localStore.setCheckpoint(pulled.lastSeq);
      summary = { ...summary, lastRemoteSeq: String(pulled.lastSeq) };
    }
    await this.host.updateLocalQueue(summary);
    this.host.reportProgress?.({
      phase: "pull-complete",
      total: pulled.changes.length,
      bytes: pulledBytes,
      startedAt: pullStartedAt,
      since: checkpoint.lastRemoteSeq,
      lastSeq: pulled.lastSeq
    });
    return {
      pulledCount: pulled.changes.length,
      summary,
      lastSeq: pulled.lastSeq,
      reachedRemoteEnd: pulled.changes.length < REMOTE_PULL_LIMIT || String(pulled.lastSeq) === String(remoteEndSeq)
    };
  }

  private async maybeAutoApplyPull(
    settings: LightweightLiveSyncSettings,
    summary: LocalStoreSummary,
    client: SyncRemoteClient
  ): Promise<AutoApplyOutcome | undefined> {
    if (settings.autoApplyPull && summary.pendingApply > 0) {
      this.host.reportProgress?.({ phase: "apply-start", pending: summary.pendingApply });
    }
    return settings.autoApplyPull && summary.pendingApply > 0
      ? this.host.applyPulledChanges(settings.couchDb.database, client)
      : undefined;
  }

  private async queueCurrentVaultForFirstAutomaticSync(
    reason: SyncReason,
    inspection: RemoteInspection,
    localStore: LocalDocumentStore
  ): Promise<void> {
    if (!AUTOMATIC_FULL_VAULT_SCAN_REASONS.has(reason) || !this.host.queueCurrentVaultForSync) {
      return;
    }

    if (!this.remoteHasNoCurrentVaultDocuments(inspection)) {
      return;
    }

    const summary = await localStore.getSummary();
    if (summary.pendingPush > 0) {
      return;
    }

    const nextSummary = await this.host.queueCurrentVaultForSync();
    if (nextSummary && nextSummary.pendingPush > 0) {
      this.host.log(`Automatic first sync queued ${nextSummary.pendingPush} vault file${nextSummary.pendingPush === 1 ? "" : "s"} after finding an empty remote vault.`);
    }
  }

  private remoteHasNoCurrentVaultDocuments(inspection: RemoteInspection): boolean {
    return (
      inspection.sample.notes === 0 &&
      inspection.sample.chunks === 0 &&
      inspection.sample.unknown === 0
    );
  }

  private logSyncResult(
    reason: SyncReason,
    databaseName: string,
    pushed: PushBatchOutcome,
    pulledCount: number,
    applied?: AutoApplyOutcome
  ): void {
    this.host.log(
      `Sync requested (${reason}). Pushed ${pushed.pushed}, deleted ${pushed.deleted}, pulled ${pulledCount} remote changes from ${databaseName}. Version history saved ${pushed.versionsSaved}, skipped ${pushed.versionsSkipped}, pruned ${pushed.versionsPruned}, failed ${pushed.versionsFailed}.${applied ? ` Applied ${applied.applied}, merged ${applied.merged}, deleted ${applied.deleted}, skipped ${applied.skipped}, waiting ${applied.waiting}, backups ${applied.backedUp}, conflicts ${applied.conflicted}, failed ${applied.failed}.` : ""}`
    );
  }

  private syncOutcomeMessage(
    pushed: PushBatchOutcome,
    pulled: PulledRemoteChanges,
    metrics: RuntimeSyncMetricsState,
    applied?: AutoApplyOutcome
  ): SyncOutcome {
    const pendingUpload = pulled.summary.pendingPush;
    const pendingApply = pulled.summary.pendingApply;
    const moreRemoteLikely = pulled.pulledCount >= REMOTE_PULL_LIMIT && !pulled.reachedRemoteEnd;
    const localUploadProgress = pushed.pushed + pushed.deleted + pushed.skipped > 0;
    const appliedProgress = applied
      ? applied.applied + applied.merged + applied.deleted + applied.skipped > 0
      : false;
    const continueSync = (pendingUpload > 0 && (localUploadProgress || appliedProgress)) || moreRemoteLikely || (pendingApply > 0 && appliedProgress);
    const localQueue = `Still waiting locally: ${pendingUpload} upload${pendingUpload === 1 ? "" : "s"}, ${pendingApply} remote apply item${pendingApply === 1 ? "" : "s"}.`;
    const remoteCatchUp = moreRemoteLikely
      ? " Remote catch-up is still paging through CouchDB because the last pull filled the 250-document page; the next pass will request the next page."
      : "";
    const nextPass = continueSync
      ? " More sync work remains, so another pass will continue automatically."
      : "";
    return {
      ok: true,
      message: `Uploaded ${pushed.pushed}, deleted ${pushed.deleted}, skipped ${pushed.skipped} unchanged file${pushed.skipped === 1 ? "" : "s"}. Version history saved ${pushed.versionsSaved}, pruned ${pushed.versionsPruned}, failed ${pushed.versionsFailed}. Downloaded ${pulled.pulledCount} remote document change${pulled.pulledCount === 1 ? "" : "s"}${pulled.reachedRemoteEnd ? " and reached the current CouchDB checkpoint" : ""}.${applied ? ` Applied ${applied.applied + applied.merged + applied.deleted}, skipped ${applied.skipped}, waiting ${applied.waiting}, failed ${applied.failed}.` : ""} ${localQueue}${remoteCatchUp}${nextPass}`,
      metrics,
      continueSync
    };
  }

  private async pushLocalChanges(
    client: SyncRemoteClient,
    localStore: LocalDocumentStore,
    settings: LightweightLiveSyncSettings
  ): Promise<PushBatchOutcome> {
    const limit = Math.max(1, settings.maxPushChangesPerSync);
    const pending = await localStore.getPendingLocalPushBatch(limit);
    const outcome: PushBatchOutcome = {
      pushed: 0,
      deleted: 0,
      skipped: 0,
      failed: 0,
      remoteDocsWritten: 0,
      remoteDocsReused: 0,
      remoteDocsConflicts: 0,
      localBytesRead: 0,
      chunkDocsBuilt: 0,
      versionsSaved: 0,
      versionsSkipped: 0,
      versionsPruned: 0,
      versionsFailed: 0
    };
    if (pending.length === 0) {
      return outcome;
    }

    const pushStartedAt = Date.now();
    const prepared: PreparedPush[] = [];
    this.host.reportProgress?.({ phase: "push-start", total: pending.length });
    for (const [index, change] of pending.entries()) {
      this.host.reportProgress?.({
        phase: "push-file-start",
        completed: index,
        total: pending.length,
        path: change.path
      });
      await this.host.yieldToUi?.();
      const single = change.deleted
        ? await this.pushOneLocalChange(client, localStore, settings, change.path, change.deleted, change.attempts)
        : await this.prepareOneLocalPush(localStore, settings, change.path, change.attempts, prepared);
      await this.host.yieldToUi?.();
      outcome.pushed += single.pushed;
      outcome.deleted += single.deleted;
      outcome.skipped += single.skipped;
      outcome.failed += single.failed;
      outcome.remoteDocsWritten += single.remoteDocsWritten;
      outcome.remoteDocsReused += single.remoteDocsReused;
      outcome.remoteDocsConflicts += single.remoteDocsConflicts;
      outcome.localBytesRead += single.localBytesRead;
      outcome.chunkDocsBuilt += single.chunkDocsBuilt;
      outcome.versionsSaved += single.versionsSaved;
      outcome.versionsSkipped += single.versionsSkipped;
      outcome.versionsPruned += single.versionsPruned;
      outcome.versionsFailed += single.versionsFailed;
      this.host.reportProgress?.({
        phase: "push-file-complete",
        completed: index + 1,
        total: pending.length,
        path: change.path,
        pushed: outcome.pushed,
        deleted: outcome.deleted,
        skipped: outcome.skipped,
        failed: outcome.failed,
        bytes: outcome.localBytesRead,
        startedAt: pushStartedAt
      });
    }
    if (prepared.length > 0) {
      const write = await this.writePreparedPushes(client, localStore, settings, prepared);
      outcome.pushed += write.pushed;
      outcome.failed += write.failed;
      outcome.remoteDocsWritten += write.remoteDocsWritten;
      outcome.remoteDocsReused += write.remoteDocsReused;
      outcome.remoteDocsConflicts += write.remoteDocsConflicts;
      outcome.versionsSaved += write.versionsSaved;
      outcome.versionsSkipped += write.versionsSkipped;
      outcome.versionsPruned += write.versionsPruned;
      outcome.versionsFailed += write.versionsFailed;
      this.host.reportProgress?.({
        phase: "push-file-complete",
        completed: pending.length,
        total: pending.length,
        path: `${prepared.length} prepared file${prepared.length === 1 ? "" : "s"}`,
        pushed: outcome.pushed,
        deleted: outcome.deleted,
        skipped: outcome.skipped,
        failed: outcome.failed,
        bytes: outcome.localBytesRead,
        startedAt: pushStartedAt
      });
    }
    this.host.reportProgress?.({
      phase: "push-complete",
      total: pending.length,
      pushed: outcome.pushed,
      deleted: outcome.deleted,
      skipped: outcome.skipped,
      failed: outcome.failed,
      bytes: outcome.localBytesRead,
      startedAt: pushStartedAt
    });
    return outcome;
  }

  private async prepareOneLocalPush(
    localStore: LocalDocumentStore,
    settings: LightweightLiveSyncSettings,
    path: string,
    previousAttempts: number,
    prepared: PreparedPush[]
  ): Promise<PushBatchOutcome> {
    try {
      const previousFingerprint = await localStore.getLocalPushFingerprint(path);
      const fileInfo = await this.host.readLocalFileInfo?.(path);
      if (localPushFingerprintMatchesFileInfo(previousFingerprint, fileInfo)) {
        await localStore.markLocalPushSucceeded([path]);
        return {
          pushed: 0,
          deleted: 0,
          skipped: 1,
          failed: 0,
          remoteDocsWritten: 0,
          remoteDocsReused: 0,
          remoteDocsConflicts: 0,
          localBytesRead: 0,
          chunkDocsBuilt: 0,
          versionsSaved: 0,
          versionsSkipped: 0,
          versionsPruned: 0,
          versionsFailed: 0
        };
      }

      const snapshot = await this.host.readLocalFileSnapshot(path);
      if (!snapshot) {
        await localStore.markLocalPushSucceeded([path]);
        await localStore.clearLocalPushFingerprints([path]);
        return {
          pushed: 0,
          deleted: 0,
          skipped: 1,
          failed: 0,
          remoteDocsWritten: 0,
          remoteDocsReused: 0,
          remoteDocsConflicts: 0,
          localBytesRead: 0,
          chunkDocsBuilt: 0,
          versionsSaved: 0,
          versionsSkipped: 0,
          versionsPruned: 0,
          versionsFailed: 0
        };
      }

      const fingerprint = await localSnapshotFingerprint(snapshot);
      if (fingerprintMatchesSnapshot(previousFingerprint, fingerprint)) {
        await localStore.markLocalPushSucceeded([path]);
        if (fingerprint !== previousFingerprint) {
          await localStore.setLocalPushFingerprint(path, fingerprint);
        }
        return {
          pushed: 0,
          deleted: 0,
          skipped: 1,
          failed: 0,
          remoteDocsWritten: 0,
          remoteDocsReused: 0,
          remoteDocsConflicts: 0,
          localBytesRead: Math.max(0, snapshot.size),
          chunkDocsBuilt: 0,
          versionsSaved: 0,
          versionsSkipped: 0,
          versionsPruned: 0,
          versionsFailed: 0
        };
      }

      const bundle = await this.host.buildLocalPushBundle(snapshot, {
        encrypt: settings.encrypt,
        passphrase: settings.passphrase,
        syncParameterSalt: settings.remoteState.syncParameterSalt,
        usePathObfuscation: settings.usePathObfuscation,
        hashAlgorithm: settings.hashAlgorithm
      });
      prepared.push({
        path,
        previousAttempts,
        fingerprint,
        bundle,
        localBytesRead: Math.max(0, snapshot.size),
        chunkDocsBuilt: bundle.chunkDocuments.length
      });
      return {
        pushed: 0,
        deleted: 0,
        skipped: 0,
        failed: 0,
        remoteDocsWritten: 0,
        remoteDocsReused: 0,
        remoteDocsConflicts: 0,
        localBytesRead: Math.max(0, snapshot.size),
        chunkDocsBuilt: bundle.chunkDocuments.length,
        versionsSaved: 0,
        versionsSkipped: 0,
        versionsPruned: 0,
        versionsFailed: 0
      };
    } catch (error) {
      return this.markLocalPushFailed(localStore, settings, path, previousAttempts, error);
    }
  }

  private async writePreparedPushes(
    client: SyncRemoteClient,
    localStore: LocalDocumentStore,
    settings: LightweightLiveSyncSettings,
    prepared: PreparedPush[]
  ): Promise<PushBatchOutcome> {
    try {
      const write = await client.putLiveSyncBundles(prepared.map((item) => item.bundle));
      await localStore.markLocalPushSucceeded(prepared.map((item) => item.path));
      for (const item of prepared) {
        await localStore.setLocalPushFingerprint(item.path, item.fingerprint);
      }
      let versionsSaved = 0;
      let versionsSkipped = 0;
      let versionsPruned = 0;
      let versionsFailed = 0;
      for (const item of prepared) {
        const versionWrite = await this.writeVersionHistory(client, settings, item.bundle.fileDocument, item.fingerprint, item.path);
        versionsSaved += versionWrite.saved;
        versionsSkipped += versionWrite.skipped;
        versionsPruned += versionWrite.pruned;
        versionsFailed += versionWrite.failed;
        await this.host.yieldToUi?.();
      }
      return {
        pushed: prepared.length,
        deleted: 0,
        skipped: 0,
        failed: 0,
        remoteDocsWritten: write.written,
        remoteDocsReused: write.reused,
        remoteDocsConflicts: write.conflicts,
        localBytesRead: 0,
        chunkDocsBuilt: 0,
        versionsSaved,
        versionsSkipped,
        versionsPruned,
        versionsFailed
      };
    } catch (error) {
      if (prepared.length > 1) {
        this.host.log(`Grouped upload failed: ${error instanceof Error ? error.message : String(error)}. Retrying files one at a time to isolate the problem.`);
        return this.writePreparedPushesIndividually(client, localStore, settings, prepared);
      }
      const failed = emptyPushOutcome();
      for (const item of prepared) {
        const single = await this.markLocalPushFailed(localStore, settings, item.path, item.previousAttempts, error);
        failed.failed += single.failed;
      }
      return failed;
    }
  }

  private async writePreparedPushesIndividually(
    client: SyncRemoteClient,
    localStore: LocalDocumentStore,
    settings: LightweightLiveSyncSettings,
    prepared: PreparedPush[]
  ): Promise<PushBatchOutcome> {
    const outcome = emptyPushOutcome();
    for (const item of prepared) {
      const single = await this.writePreparedPushes(client, localStore, settings, [item]);
      outcome.pushed += single.pushed;
      outcome.failed += single.failed;
      outcome.remoteDocsWritten += single.remoteDocsWritten;
      outcome.remoteDocsReused += single.remoteDocsReused;
      outcome.remoteDocsConflicts += single.remoteDocsConflicts;
      outcome.versionsSaved += single.versionsSaved;
      outcome.versionsSkipped += single.versionsSkipped;
      outcome.versionsPruned += single.versionsPruned;
      outcome.versionsFailed += single.versionsFailed;
      await this.host.yieldToUi?.();
    }
    return outcome;
  }

  private async markLocalPushFailed(
    localStore: LocalDocumentStore,
    settings: LightweightLiveSyncSettings,
    path: string,
    previousAttempts: number,
    error: unknown
  ): Promise<PushBatchOutcome> {
    const message = error instanceof Error ? error.message : String(error);
    const attemptsAfterFailure = previousAttempts + 1;
    const retryDelayMs = failedPushRetryDelayMs(settings, attemptsAfterFailure);
    const retryAt = Date.now() + retryDelayMs;
    await localStore.markLocalPushFailed(path, message, retryAt);
    this.host.log(`Local push failed for ${path}: ${message}. Will retry in ${Math.ceil(retryDelayMs / 1000)}s.`);
    return {
      pushed: 0,
      deleted: 0,
      skipped: 0,
      failed: 1,
      remoteDocsWritten: 0,
      remoteDocsReused: 0,
      remoteDocsConflicts: 0,
      localBytesRead: 0,
      chunkDocsBuilt: 0,
      versionsSaved: 0,
      versionsSkipped: 0,
      versionsPruned: 0,
      versionsFailed: 0
    };
  }

  private async skipPullAfterFirstUpload(
    client: SyncRemoteClient,
    localStore: LocalDocumentStore,
    inspection: RemoteInspection,
    pushed: PushBatchOutcome
  ): Promise<boolean> {
    const wroteLocalChanges = pushed.pushed + pushed.deleted > 0;
    const remoteHadNoVaultDocuments = this.remoteHasNoCurrentVaultDocuments(inspection);

    if (!wroteLocalChanges || !remoteHadNoVaultDocuments) {
      return false;
    }

    const afterPush = await client.inspect();
    await this.host.updateRemoteInspection(afterPush);
    await localStore.setCheckpoint(afterPush.updateSequence);
    this.host.log("First upload completed against an empty remote vault; skipped pulling this device's own uploaded documents.");
    return true;
  }

  private async pushOneLocalChange(
    client: SyncRemoteClient,
    localStore: LocalDocumentStore,
    settings: LightweightLiveSyncSettings,
    path: string,
    deleted: boolean,
    previousAttempts: number
  ): Promise<PushBatchOutcome> {
    try {
      if (deleted) {
        const id = await pathToLiveSyncDocumentId(
          path,
          settings.usePathObfuscation ? settings.passphrase : false,
          false
        );
        await client.deleteLiveSyncDocument(id);
        await localStore.markLocalPushSucceeded([path]);
        await localStore.clearLocalPushFingerprints([path]);
        return {
          pushed: 0,
          deleted: 1,
          skipped: 0,
          failed: 0,
          remoteDocsWritten: 0,
          remoteDocsReused: 0,
          remoteDocsConflicts: 0,
          localBytesRead: 0,
          chunkDocsBuilt: 0,
          versionsSaved: 0,
          versionsSkipped: 0,
          versionsPruned: 0,
          versionsFailed: 0
        };
      }

      const previousFingerprint = await localStore.getLocalPushFingerprint(path);
      const fileInfo = await this.host.readLocalFileInfo?.(path);
      if (localPushFingerprintMatchesFileInfo(previousFingerprint, fileInfo)) {
        await localStore.markLocalPushSucceeded([path]);
        return {
          pushed: 0,
          deleted: 0,
          skipped: 1,
          failed: 0,
          remoteDocsWritten: 0,
          remoteDocsReused: 0,
          remoteDocsConflicts: 0,
          localBytesRead: 0,
          chunkDocsBuilt: 0,
          versionsSaved: 0,
          versionsSkipped: 0,
          versionsPruned: 0,
          versionsFailed: 0
        };
      }

      const snapshot = await this.host.readLocalFileSnapshot(path);
      if (!snapshot) {
        await localStore.markLocalPushSucceeded([path]);
        await localStore.clearLocalPushFingerprints([path]);
        return {
          pushed: 0,
          deleted: 0,
          skipped: 1,
          failed: 0,
          remoteDocsWritten: 0,
          remoteDocsReused: 0,
          remoteDocsConflicts: 0,
          localBytesRead: 0,
          chunkDocsBuilt: 0,
          versionsSaved: 0,
          versionsSkipped: 0,
          versionsPruned: 0,
          versionsFailed: 0
        };
      }

      const fingerprint = await localSnapshotFingerprint(snapshot);
      if (fingerprintMatchesSnapshot(previousFingerprint, fingerprint)) {
        await localStore.markLocalPushSucceeded([path]);
        if (fingerprint !== previousFingerprint) {
          await localStore.setLocalPushFingerprint(path, fingerprint);
        }
        return {
          pushed: 0,
          deleted: 0,
          skipped: 1,
          failed: 0,
          remoteDocsWritten: 0,
          remoteDocsReused: 0,
          remoteDocsConflicts: 0,
          localBytesRead: Math.max(0, snapshot.size),
          chunkDocsBuilt: 0,
          versionsSaved: 0,
          versionsSkipped: 0,
          versionsPruned: 0,
          versionsFailed: 0
        };
      }

      const bundle = await this.host.buildLocalPushBundle(snapshot, {
        encrypt: settings.encrypt,
        passphrase: settings.passphrase,
        syncParameterSalt: settings.remoteState.syncParameterSalt,
        usePathObfuscation: settings.usePathObfuscation,
        hashAlgorithm: settings.hashAlgorithm
      });
      const write = await client.putLiveSyncBundle(bundle.fileDocument, bundle.chunkDocuments);
      const versionWrite = await this.writeVersionHistory(client, settings, bundle.fileDocument, fingerprint, path);
      await localStore.markLocalPushSucceeded([path]);
      await localStore.setLocalPushFingerprint(path, fingerprint);
      return {
        pushed: 1,
        deleted: 0,
        skipped: 0,
        failed: 0,
        remoteDocsWritten: write.written,
        remoteDocsReused: write.reused,
        remoteDocsConflicts: write.conflicts,
        localBytesRead: Math.max(0, snapshot.size),
        chunkDocsBuilt: bundle.chunkDocuments.length,
        versionsSaved: versionWrite.saved,
        versionsSkipped: versionWrite.skipped,
        versionsPruned: versionWrite.pruned,
        versionsFailed: versionWrite.failed
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attemptsAfterFailure = previousAttempts + 1;
      const retryDelayMs = failedPushRetryDelayMs(settings, attemptsAfterFailure);
      const retryAt = Date.now() + retryDelayMs;
      await localStore.markLocalPushFailed(path, message, retryAt);
      this.host.log(`Local push failed for ${path}: ${message}. Will retry in ${Math.ceil(retryDelayMs / 1000)}s.`);
      return {
        pushed: 0,
        deleted: 0,
        skipped: 0,
        failed: 1,
        remoteDocsWritten: 0,
        remoteDocsReused: 0,
        remoteDocsConflicts: 0,
        localBytesRead: 0,
        chunkDocsBuilt: 0,
        versionsSaved: 0,
        versionsSkipped: 0,
        versionsPruned: 0,
        versionsFailed: 0
      };
    }
  }

  private async writeVersionHistory(
    client: SyncRemoteClient,
    settings: LightweightLiveSyncSettings,
    fileDocument: LiveSyncPushBundle["fileDocument"],
    fingerprint: string,
    path: string
  ): Promise<{ saved: number; skipped: number; pruned: number; failed: number }> {
    if (!settings.versioningEnabled) {
      return { saved: 0, skipped: 0, pruned: 0, failed: 0 };
    }
    try {
      const result = await writeVersionForFile(client, fileDocument, fingerprint, {
        maxVersionsPerFile: settings.maxVersionsPerFile,
        maxVersionAgeDays: settings.maxVersionAgeDays
      });
      return { ...result, failed: 0 };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.host.log(`Version history failed for ${path}: ${message}. The file upload still completed.`);
      return { saved: 0, skipped: 0, pruned: 0, failed: 1 };
    }
  }

  private createRemoteClient(settings: LightweightLiveSyncSettings): SyncRemoteClient {
    return this.host.createRemoteClient?.(settings) ?? new CouchDbClient(settings.couchDb);
  }
}

function estimatedJsonBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return 0;
  }
}
