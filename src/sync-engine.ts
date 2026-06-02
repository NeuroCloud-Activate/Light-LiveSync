import { CouchDbClient, type RemoteInspection } from "./couchdb-client";
import { pathToLiveSyncDocumentId, type LiveSyncBuildOptions, type LiveSyncPushBundle, type LocalFileSnapshot } from "./livesync-document-builder";
import type { LocalDocumentStore, LocalStoreSummary } from "./local-document-store";
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
  merged: number;
  backedUp: number;
  conflicted: number;
  failed: number;
};

export type SyncRemoteClient = Pick<
  CouchDbClient,
  "ensureDatabase" | "ensureSyncParameters" | "inspect" | "getChangesSince" | "deleteLiveSyncDocument" | "putLiveSyncBundle"
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
};

type ReadySyncSettings = {
  ok: true;
  settings: LightweightLiveSyncSettings;
};

type NotReadySyncSettings = Extract<SyncOutcome, { ok: false }>;

type PulledRemoteChanges = {
  pulledCount: number;
  summary: LocalStoreSummary;
};

const REMOTE_CACHE_BATCH_SIZE = 25;

function failedPushRetryDelayMs(settings: LightweightLiveSyncSettings, attemptsAfterFailure: number): number {
  const baseMs = Math.max(5, settings.failedPushRetryBaseSec) * 1000;
  const maxMs = Math.max(baseMs, settings.failedPushRetryMaxSec * 1000);
  const multiplier = 2 ** Math.min(8, Math.max(0, attemptsAfterFailure - 1));
  return Math.min(maxMs, baseMs * multiplier);
}

function emptySyncMetrics(): RuntimeSyncMetricsState {
  return { ...DEFAULT_RUNTIME_SYNC_METRICS };
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function localSnapshotFingerprint(snapshot: LocalFileSnapshot): Promise<string> {
  const bytes = typeof snapshot.content === "string"
    ? new TextEncoder().encode(snapshot.content)
    : new Uint8Array(snapshot.content);
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  );
  const type = typeof snapshot.content === "string" ? "text" : "binary";
  return `${type}:${snapshot.size}:${bytesToHex(new Uint8Array(digest))}`;
}

export type SyncEngineHost = {
  getSettings(): LightweightLiveSyncSettings;
  updateRemoteInspection(inspection: RemoteInspection): Promise<void>;
  updateLocalQueue(summary: LocalStoreSummary): Promise<void>;
  getLocalStore(databaseName: string): LocalDocumentStore;
  readLocalFileSnapshot(path: string): Promise<LocalFileSnapshot | undefined>;
  buildLocalPushBundle(snapshot: LocalFileSnapshot, options: LiveSyncBuildOptions): Promise<LiveSyncPushBundle>;
  applyPulledChanges(databaseName: string): Promise<AutoApplyOutcome>;
  createRemoteClient?(settings: LightweightLiveSyncSettings): SyncRemoteClient;
  isNetworkLikelyOnline?(): boolean;
  yieldToUi?(): Promise<void>;
  log(message: string): void;
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
      return { ok: false, message: "Credentials are locked. Use the unlock command before syncing." };
    }
    if (settings.requireE2EE && (!settings.encrypt || !settings.passphrase)) {
      return { ok: false, message: "E2EE is required. Unlock or import the vault E2EE passphrase before syncing." };
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
    const inspectStartedAt = Date.now();
    const inspection = await client.inspect();
    metrics.inspectMs = elapsedMs(inspectStartedAt);
    await this.host.updateRemoteInspection(inspection);

    if (!inspection.syncParametersPresent) {
      return {
        ok: true,
        message: `Remote reachable (${inspection.documentCount} docs). Sync parameters are not initialised yet.`,
        metrics
      };
    }

    const localStore = this.host.getLocalStore(settings.couchDb.database);
    const pushStartedAt = Date.now();
    const pushed = await this.pushLocalChanges(client, localStore, settings);
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

    const pullStartedAt = Date.now();
    let pulled = await this.pullRemoteChanges(client, localStore);
    metrics.pullMs = elapsedMs(pullStartedAt);
    metrics.pulledChanges = pulled.pulledCount;

    const applyStartedAt = Date.now();
    const applied = await this.maybeAutoApplyPull(settings, pulled.summary);
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

    this.logSyncResult(reason, inspection.databaseName, pushed, pulled.pulledCount, applied);
    return this.syncOutcomeMessage(pushed, pulled, metrics, applied);
  }

  private readySyncSettings(): ReadySyncSettings | NotReadySyncSettings {
    const settings = this.host.getSettings();
    if (!settings.configured || !hasUsableRemote(settings)) {
      return { ok: false, message: "Light-LiveSync is not configured." };
    }
    if (credentialsAreLocked(settings)) {
      return { ok: false, message: "Credentials are locked. Use the unlock command before syncing." };
    }
    if (settings.requireE2EE && (!settings.encrypt || !settings.passphrase)) {
      return { ok: false, message: "E2EE is required. Unlock or import the vault E2EE passphrase before syncing." };
    }
    return { ok: true, settings };
  }

  private async pullRemoteChanges(
    client: SyncRemoteClient,
    localStore: LocalDocumentStore
  ): Promise<PulledRemoteChanges> {
    const checkpoint = await localStore.getCheckpoint();
    const pulled = await client.getChangesSince(checkpoint.lastRemoteSeq, 100);
    let summary = await localStore.getSummary();
    for (let index = 0; index < pulled.changes.length; index += REMOTE_CACHE_BATCH_SIZE) {
      const batch = pulled.changes.slice(index, index + REMOTE_CACHE_BATCH_SIZE);
      await this.host.yieldToUi?.();
      summary = await localStore.cacheRemoteChanges(batch);
      await this.host.yieldToUi?.();
    }
    if (pulled.changes.length === 0 && pulled.lastSeq !== checkpoint.lastRemoteSeq) {
      await localStore.setCheckpoint(pulled.lastSeq);
      summary = await localStore.getSummary();
    }
    await this.host.updateLocalQueue(summary);
    return {
      pulledCount: pulled.changes.length,
      summary
    };
  }

  private async maybeAutoApplyPull(
    settings: LightweightLiveSyncSettings,
    summary: LocalStoreSummary
  ): Promise<AutoApplyOutcome | undefined> {
    return settings.autoApplyPull && summary.pendingApply > 0
      ? this.host.applyPulledChanges(settings.couchDb.database)
      : undefined;
  }

  private logSyncResult(
    reason: SyncReason,
    databaseName: string,
    pushed: PushBatchOutcome,
    pulledCount: number,
    applied?: AutoApplyOutcome
  ): void {
    this.host.log(
      `Sync requested (${reason}). Pushed ${pushed.pushed}, deleted ${pushed.deleted}, pulled ${pulledCount} remote changes from ${databaseName}.${applied ? ` Applied ${applied.applied}, merged ${applied.merged}, deleted ${applied.deleted}, backups ${applied.backedUp}, conflicts ${applied.conflicted}.` : ""}`
    );
  }

  private syncOutcomeMessage(
    pushed: PushBatchOutcome,
    pulled: PulledRemoteChanges,
    metrics: RuntimeSyncMetricsState,
    applied?: AutoApplyOutcome
  ): SyncOutcome {
    return {
      ok: true,
      message: `Pushed ${pushed.pushed}. Pulled ${pulled.pulledCount}.${applied ? ` Applied ${applied.applied + applied.merged + applied.deleted}.` : ""} Pending apply: ${pulled.summary.pendingApply}.`,
      metrics
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
      chunkDocsBuilt: 0
    };
    if (pending.length === 0) {
      return outcome;
    }

    for (const change of pending) {
      await this.host.yieldToUi?.();
      const single = await this.pushOneLocalChange(client, localStore, settings, change.path, change.deleted, change.attempts);
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
    }
    return outcome;
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
          chunkDocsBuilt: 0
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
          chunkDocsBuilt: 0
        };
      }

      const fingerprint = await localSnapshotFingerprint(snapshot);
      if (fingerprint === await localStore.getLocalPushFingerprint(path)) {
        await localStore.markLocalPushSucceeded([path]);
        return {
          pushed: 0,
          deleted: 0,
          skipped: 1,
          failed: 0,
          remoteDocsWritten: 0,
          remoteDocsReused: 0,
          remoteDocsConflicts: 0,
          localBytesRead: Math.max(0, snapshot.size),
          chunkDocsBuilt: 0
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
        chunkDocsBuilt: bundle.chunkDocuments.length
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
        chunkDocsBuilt: 0
      };
    }
  }

  private createRemoteClient(settings: LightweightLiveSyncSettings): SyncRemoteClient {
    return this.host.createRemoteClient?.(settings) ?? new CouchDbClient(settings.couchDb);
  }
}
