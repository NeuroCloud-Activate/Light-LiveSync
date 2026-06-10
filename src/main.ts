import { Notice, Platform, Plugin, TFile, normalizePath, requestUrl } from "obsidian";
import { decryptCredentialPayload, encryptCredentialPayload } from "./credential-store";
import { DocumentReconstructor, type ReconstructionBatchSummary } from "./document-reconstructor";
import { applyReadyPreviewsToLiveVault, type LiveVaultApplyResult } from "./live-vault-applier";
import { exportReadyPreviews } from "./preview-exporter";
import { planObsidianConfigRefresh, shouldAutoApplyPluginRefresh, shouldPromptForAppReload } from "./obsidian-config-refresh";
import { PluginReloadPromptModal } from "./plugin-reload-prompt-modal";
import { ServerCredentialsModal } from "./server-credentials-modal";
import { applyReadyPreviewsToStaging, type StagingApplyResult } from "./staging-applier";
import { DirectCouchDbSetupModal } from "./direct-setup-modal";
import {
  buildCouchDbSetupCommand,
  normaliseDirectCouchDbSetupInput,
  settingsFromDirectCouchDbSetup,
  type DirectCouchDbSetupInput
} from "./direct-setup";
import { decodeSettingsFromSetupUri } from "./setup-uri";
import { generateAdditionalDeviceSetupUri } from "./setup-uri-export";
import { decodeSettingsFromSetupQr } from "./setup-qr";
import { SetupUriModal } from "./setup-uri-modal";
import { GeneratedSetupUriModal } from "./generated-setup-uri-modal";
import { LightweightLiveSyncSettingTab } from "./settings-tab";
import { LocalDocumentStore, type LocalStoreSummary, type LocalSyncWorkState } from "./local-document-store";
import {
  DEFAULT_SETTINGS,
  DEFAULT_REMOTE_CHECK_INTERVAL_SEC,
  FOREGROUND_MOBILE_REMOTE_CHECK_INTERVAL_SEC,
  LEGACY_DEFAULT_VAULT_CHANGE_BATCH_WINDOW_SEC,
  applyCredentialPayload,
  type CredentialPayload,
  credentialPayloadFromSettings,
  credentialsAreLocked,
  hasCredentialPayload,
  hasUsableRemote,
  type LocalQueueState,
  type LocalPreviewState,
  type LocalStagingState,
  type LocalLiveApplyState,
  type RuntimeDiagnosticsState,
  type RemoteInspectionState,
  settingsForDisk,
  settingsFromUpstreamSetup,
  type LightweightLiveSyncSettings
} from "./settings";
import { SyncScheduler } from "./scheduler";
import {
  LightweightSyncEngine,
  localPushFingerprintMatchesFileInfo,
  type LocalFileInfo,
  type LocalVaultStats,
  type SyncOutcome,
  type SyncProgress,
  type SyncRemoteClient
} from "./sync-engine";
import { OptionalSyncWorkerClient } from "./sync-worker-client";
import { EMBEDDED_SYNC_WORKER_SOURCE } from "./embedded-sync-worker-source";
import { CalmStatusPresenter } from "./status-presenter";
import type { LiveSyncBuildOptions, LocalFileSnapshot } from "./livesync-document-builder";
import { CouchDbClient, CouchDbClientError, type RemoteInspection } from "./couchdb-client";
import { isLiveSyncChunkDocument, type LiveSyncChunkDocument } from "./livesync-constants";
import { verifyCouchDbConnection } from "./connection-verifier";
import { buildRuntimeSmokeCheckReport } from "./runtime-smoke-check";
import { buildRuntimeCapabilityReport, type RuntimeCapabilitySnapshot } from "./runtime-capabilities";
import {
  RUNTIME_EVIDENCE_FOLDER,
  formatRuntimeEvidenceReport,
  runtimeEvidenceReportPath
} from "./runtime-evidence-report";
import {
  clearSessionCredentialReloadProof,
  clearSessionCredentialPayload,
  loadSessionCredentialPayload,
  saveSessionCredentialReloadProof,
  saveSessionCredentialPayload,
  verifySessionCredentialReloadProof,
  type SessionCredentialScope
} from "./session-credential-cache";
import {
  isTextSyncPath,
  shouldScanVaultFolder,
  shouldSyncVaultPath,
  type VaultSyncPathOptions
} from "./vault-scan";
import {
  listRecoveryBackups,
  restoreRecoveryBackup,
  type RecoveryBackupEntry
} from "./recovery-backups";
import {
  type DeletedFileVersionEntry,
  listFileVersions,
  listRecentlyDeletedFileVersions,
  restoreFileVersion,
  type FileVersionEntry
} from "./version-history";

type CommandSpec = {
  id: string;
  name: string;
  callback(): void;
};

type PullOperationContext = {
  store: LocalDocumentStore;
  reconstructor: DocumentReconstructor;
};

type VaultListAdapter = {
  list?(path: string): Promise<{ files: string[]; folders: string[] }>;
  exists?(path: string): Promise<boolean>;
  stat?(path: string): Promise<{ ctime: number; mtime: number; size: number } | null>;
  read?(path: string): Promise<string>;
  readBinary?(path: string): Promise<ArrayBuffer>;
};

type ObsidianPluginManager = {
  enabledPlugins?: Set<string> | string[];
  plugins?: Record<string, unknown>;
  manifests?: Record<string, unknown>;
  loadManifests?(): Promise<void> | void;
  reloadPlugin?(id: string): Promise<void> | void;
  unloadPlugin?(id: string): Promise<void> | void;
  loadPlugin?(id: string): Promise<void> | void;
  enablePlugin?(id: string): Promise<void> | void;
  disablePlugin?(id: string): Promise<void> | void;
};

function hasLiveApplyActivity(result: LiveVaultApplyResult): boolean {
  return result.applied + result.merged + result.deleted + result.skipped + result.waiting + result.backedUp + result.conflicted + result.failed > 0;
}

function applyReasonSummary(label: string, reasons: string[]): string {
  return reasons.length > 0 ? ` ${label}: ${reasons.join("; ")}` : "";
}

function hasRecordKey(record: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(record, key);
}

const FAST_CONFIG_SYNC_DELAY_MS = 2000;
const OBSIDIAN_PLUGIN_REFRESH_DELAY_MS = 5000;
const OBSIDIAN_PLUGIN_REFRESH_RETRY_MS = 5000;
const OBSIDIAN_PLUGIN_REFRESH_MAX_ATTEMPTS = 4;
const SNAPSHOT_CACHE_MAX_ENTRIES = 96;
const SNAPSHOT_CACHE_MAX_BYTES = 12 * 1024 * 1024;
const SNAPSHOT_CACHE_MAX_FILE_BYTES = 2 * 1024 * 1024;
const CONFIG_FALLBACK_SCAN_INTERVAL_MS = 60 * 1000;

type SnapshotCacheEntry = {
  snapshot: LocalFileSnapshot;
  cacheKey: string;
  bytes: number;
  usedAt: number;
};

export default class LightweightLiveSyncPlugin extends Plugin {
  settings: LightweightLiveSyncSettings = DEFAULT_SETTINGS;
  private scheduler!: SyncScheduler;
  private engine!: LightweightSyncEngine;
  private statusBar?: HTMLElement;
  private periodicTimer?: number;
  private workerClient?: OptionalSyncWorkerClient;
  private statusPresenter?: CalmStatusPresenter<number>;
  private localStores = new Map<string, LocalDocumentStore>();
  private suppressVaultEventQueue = false;
  private vaultChangeBatchTimer?: number;
  private vaultChangeBatchDueAt = 0;
  private configuredAtLoad = false;
  private sessionCredentials: CredentialPayload | null = null;
  private lastProgressLogAt = 0;
  private statusUploadRate = "0";
  private statusDownloadRate = "0";
  private activityLogListeners = new Set<() => void>();
  private completedStatusTimer?: number;
  private workerScriptSourceCache?: string;
  private runtimeDiagnosticsSaveTimer?: number;
  private lastForegroundRemoteCheckAt = 0;
  private localSnapshotCache = new Map<string, SnapshotCacheEntry>();
  private localSnapshotCacheBytes = 0;
  private layoutReadyAt = 0;
  private obsidianPluginRefreshTimer?: number;
  private obsidianPluginRefreshAttempts = 0;
  private pendingObsidianPluginRefreshPaths = new Set<string>();
  private lastConfigFallbackScanAt = 0;
  private configFallbackScanPromise?: Promise<LocalStoreSummary | undefined>;
  private lastPluginReloadPromptKey = "";
  private pendingMobileReloadSensitiveApplyPaths = new Set<string>();
  private approvedMobileReloadSensitiveApplyPaths = new Set<string>();
  private mobileReloadAfterApprovedApply = false;

  async onload(): Promise<void> {
    await this.loadSettings();
    await this.restorePersistentCredentials();
    await this.restoreSessionCredentials();
    await this.markInterruptedSyncIfNeeded();
    this.configuredAtLoad = this.settings.configured;

    this.engine = new LightweightSyncEngine({
      getSettings: () => this.getRuntimeSettings(),
      updateRemoteInspection: (inspection) => this.updateRemoteInspection(inspection),
      updateLocalQueue: (summary) => this.updateLocalQueue(summary),
      queueCurrentVaultForSync: () => this.queueCurrentVaultForSync("Automatic first sync"),
      getLocalVaultStats: () => this.getLocalVaultStats(),
      getLocalStore: (databaseName) => this.getLocalStore(databaseName),
      readLocalFileInfo: (path) => this.readLocalFileInfo(path),
      readLocalFileSnapshot: (path) => this.readLocalFileSnapshot(path),
      buildLocalPushBundle: (snapshot, options) => this.buildLocalPushBundle(snapshot, options),
      applyPulledChanges: (databaseName, client) => this.applyPulledChanges(databaseName, client),
      isNetworkLikelyOnline: () => this.isNetworkLikelyOnline(),
      yieldToUi: () => this.yieldToUi(),
      log: (message) => this.log(message),
      reportProgress: (progress) => this.reportSyncProgress(progress)
    });

    this.scheduler = new SyncScheduler(this.engine, {
      getMinimumIntervalMs: (reason) => this.minimumIntervalMsForSyncReason(reason),
      getFailureCooldownMs: () => this.settings.syncFailureCooldownSec * 1000,
      log: (message) => this.log(message),
      setStatus: (message) => this.setStatus(message),
      onSyncStart: (reason, startedAt) => this.recordSyncStart(reason, startedAt),
      onSyncFinish: (details) => this.recordSyncFinish(details)
    });
    this.workerClient = new OptionalSyncWorkerClient({
      enabled: () => this.settings.useBackgroundWorker,
      scriptUrl: () => this.workerScriptUrl(),
      scriptSource: () => this.workerScriptSource(),
      yieldToUi: () => this.yieldToUi(),
      log: (message) => this.log(message)
    });

    this.statusBar = this.addStatusBarItem();
    this.statusBar.addClass("light-livesync-status");
    this.statusPresenter = new CalmStatusPresenter<number>({
      now: () => Date.now(),
      setText: (message) => this.statusBar?.setText(`LLS: ${this.compactStatus(message)}`),
      setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
      clearTimer: (timer) => window.clearTimeout(timer)
    }, { minimumVisibleMs: 1000 });
    this.setStatus("Light-LiveSync loaded");

    this.addSettingTab(new LightweightLiveSyncSettingTab(this));
    this.registerCommands();
    this.registerProtocolHandler();
    this.registerVaultEvents();
    this.registerNetworkEvents();
    this.registerForegroundRemoteChecks();
    this.reschedulePeriodicSync();

    this.app.workspace.onLayoutReady(() => {
      this.layoutReadyAt = Date.now();
      if (this.configuredAtLoad && this.settings.syncOnStart && this.canRunAutomaticSync()) {
        this.log("Startup sync requested immediately.");
        this.scheduler.request("startup", true);
        window.setTimeout(() => {
          void this.runAutomaticRuntimeCheck();
        }, 2500);
      } else {
        void this.runAutomaticRuntimeCheck();
      }
    });
  }

  onunload(): void {
    this.scheduler?.cancel();
    this.workerClient?.dispose();
    this.statusPresenter?.cancel();
    this.clearCompletedStatusTimer();
    this.clearRuntimeDiagnosticsSaveTimer();
    this.clearObsidianPluginRefreshTimer();
    this.clearPeriodicTimer();
    this.clearVaultChangeBatchTimer();
    this.clearLocalSnapshotCache();
    for (const store of this.localStores.values()) {
      store.close();
    }
    this.localStores.clear();
  }

  async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<LightweightLiveSyncSettings> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loaded,
      couchDb: {
        ...DEFAULT_SETTINGS.couchDb,
        ...loaded?.couchDb
      },
      remoteState: {
        ...DEFAULT_SETTINGS.remoteState,
        ...loaded?.remoteState
      },
      localQueue: {
        ...DEFAULT_SETTINGS.localQueue,
        ...loaded?.localQueue
      },
      localPreview: {
        ...DEFAULT_SETTINGS.localPreview,
        ...loaded?.localPreview
      },
      localStaging: {
        ...DEFAULT_SETTINGS.localStaging,
        ...loaded?.localStaging
      },
      localLiveApply: {
        ...DEFAULT_SETTINGS.localLiveApply,
        ...loaded?.localLiveApply
      },
      runtime: {
        ...DEFAULT_SETTINGS.runtime,
        ...loaded?.runtime,
        lastSyncMetrics: {
          ...DEFAULT_SETTINGS.runtime.lastSyncMetrics,
          ...loaded?.runtime?.lastSyncMetrics
        },
        activityLog: loaded?.runtime?.activityLog ?? DEFAULT_SETTINGS.runtime.activityLog
      },
      upstreamSettings: loaded?.upstreamSettings ?? DEFAULT_SETTINGS.upstreamSettings,
      credentialStore: loaded?.credentialStore ?? null,
      autoUnlockCredentials: true,
      credentialUnlockKey: loaded?.credentialUnlockKey ?? DEFAULT_SETTINGS.credentialUnlockKey,
      keepUnlockedDuringSession: true,
      settingsTab: loaded?.settingsTab ?? DEFAULT_SETTINGS.settingsTab
    };
    if (loaded?.maxPushChangesPerSync === undefined || loaded.maxPushChangesPerSync <= 4) {
      this.settings.maxPushChangesPerSync = DEFAULT_SETTINGS.maxPushChangesPerSync;
    }
    if (loaded?.maxStorageApplyConcurrency === undefined || loaded.maxStorageApplyConcurrency <= 25) {
      this.settings.maxStorageApplyConcurrency = DEFAULT_SETTINGS.maxStorageApplyConcurrency;
    }
    if (loaded?.periodicSyncIntervalSec === undefined || loaded.periodicSyncIntervalSec > DEFAULT_REMOTE_CHECK_INTERVAL_SEC) {
      this.settings.periodicSyncIntervalSec = DEFAULT_REMOTE_CHECK_INTERVAL_SEC;
    } else if (loaded.periodicSyncIntervalSec < FOREGROUND_MOBILE_REMOTE_CHECK_INTERVAL_SEC) {
      this.settings.periodicSyncIntervalSec = FOREGROUND_MOBILE_REMOTE_CHECK_INTERVAL_SEC;
    }
    if (
      loaded?.vaultChangeBatchWindowSec === undefined ||
      loaded.vaultChangeBatchWindowSec === LEGACY_DEFAULT_VAULT_CHANGE_BATCH_WINDOW_SEC ||
      loaded.vaultChangeBatchWindowSec >= 60
    ) {
      this.settings.vaultChangeBatchWindowSec = DEFAULT_SETTINGS.vaultChangeBatchWindowSec;
    }
    if (loaded?.minimumSyncIntervalMs === undefined || loaded.minimumSyncIntervalMs >= 30000) {
      this.settings.minimumSyncIntervalMs = DEFAULT_SETTINGS.minimumSyncIntervalMs;
    }
    if (Platform.isMobile && !this.settings.couchDb.useRequestApi) {
      this.settings.couchDb.useRequestApi = true;
    }
  }

  async saveSettingsAndReschedule(): Promise<void> {
    await this.saveData(settingsForDisk(this.settings));
    this.reschedulePeriodicSync();
  }

  onActivityLogChanged(listener: () => void): () => void {
    this.activityLogListeners.add(listener);
    return () => {
      this.activityLogListeners.delete(listener);
    };
  }

  getRuntimeSettings(): LightweightLiveSyncSettings {
    return this.sessionCredentials
      ? applyCredentialPayload(this.settings, this.sessionCredentials)
      : this.settings;
  }

  async setKeepUnlockedDuringSession(value: boolean): Promise<void> {
    this.settings.keepUnlockedDuringSession = value;
    if (!value) {
      clearSessionCredentialPayload(this.sessionCredentialScope());
      this.sessionCredentials = null;
      this.settings = settingsForDisk(this.settings);
    } else if (this.sessionCredentials) {
      await this.rememberSessionCredentials(this.sessionCredentials);
    }
    await this.saveSettingsAndReschedule();
  }

  private sessionCredentialScope(settings = this.settings): SessionCredentialScope {
    const vaultWithName = this.app.vault as { getName?: () => string };
    return {
      vaultName: vaultWithName.getName?.() ?? "vault",
      pluginId: this.manifest.id,
      uri: settings.couchDb.uri,
      database: settings.couchDb.database,
      username: settings.couchDb.username
    };
  }

  private async restoreSessionCredentials(): Promise<void> {
    if (this.sessionCredentials) {
      return;
    }
    if (!this.settings.keepUnlockedDuringSession || !this.settings.credentialStore || !hasUsableRemote(this.settings)) {
      return;
    }

    const payload = await loadSessionCredentialPayload(this.sessionCredentialScope());
    if (!payload || !hasCredentialPayload(payload)) {
      return;
    }

    this.sessionCredentials = payload;
    this.settings = applyCredentialPayload(this.settings, payload);
    await this.refreshAutoUnlockStore(payload);
    this.log("Credentials restored for this Obsidian session.");
  }

  private async restorePersistentCredentials(): Promise<boolean> {
    if (
      !this.settings.autoUnlockCredentials ||
      !this.settings.credentialStore ||
      !this.settings.credentialUnlockKey ||
      !hasUsableRemote(this.settings)
    ) {
      return false;
    }

    try {
      const payload = await decryptCredentialPayload(this.settings.credentialStore, this.settings.credentialUnlockKey);
      if (!hasCredentialPayload(payload)) {
        return false;
      }
      this.sessionCredentials = payload;
      this.settings = applyCredentialPayload(this.settings, payload);
      await this.refreshAutoUnlockStore(payload);
      this.log("Credentials restored automatically from this device.");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Automatic credential restore failed: ${message}`);
      return false;
    }
  }

  private async rememberSessionCredentials(payload: CredentialPayload): Promise<void> {
    if (!hasCredentialPayload(payload)) {
      return;
    }

    if (!this.settings.keepUnlockedDuringSession || !hasUsableRemote(this.settings)) {
      clearSessionCredentialPayload(this.sessionCredentialScope());
      return;
    }

    try {
      await saveSessionCredentialPayload(this.sessionCredentialScope(), payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Session credential cache unavailable: ${message}`);
    }
  }

  async setAutoUnlockCredentials(value: boolean): Promise<void> {
    this.settings.autoUnlockCredentials = value;
    if (!value && this.sessionCredentials && hasCredentialPayload(this.sessionCredentials)) {
      this.settings.credentialStore = await this.encryptCredentialPayloadForSettings(this.settings, this.sessionCredentials, this.sessionCredentials.passphrase);
      this.settings.credentialUnlockKey = "";
    } else if (!value) {
      this.settings.credentialUnlockKey = "";
    } else if (this.sessionCredentials && hasCredentialPayload(this.sessionCredentials)) {
      this.settings.credentialStore = await this.encryptCredentialPayloadForSettings(this.settings, this.sessionCredentials);
    }
    await this.saveSettingsAndReschedule();
  }

  private async encryptCredentialPayloadForSettings(
    settings: LightweightLiveSyncSettings,
    payload: CredentialPayload,
    fallbackUnlockPassphrase = ""
  ) {
    const unlockPassphrase = settings.autoUnlockCredentials
      ? this.ensureCredentialUnlockKey(settings)
      : fallbackUnlockPassphrase || payload.passphrase;
    return encryptCredentialPayload(payload, unlockPassphrase, settings.credentialStore);
  }

  private async refreshAutoUnlockStore(payload: CredentialPayload): Promise<void> {
    if (!this.settings.autoUnlockCredentials || !hasCredentialPayload(payload)) {
      return;
    }
    this.settings.credentialStore = await this.encryptCredentialPayloadForSettings(this.settings, payload);
    await this.saveSettingsAndReschedule();
  }

  private ensureCredentialUnlockKey(settings: LightweightLiveSyncSettings): string {
    if (!settings.credentialUnlockKey) {
      settings.credentialUnlockKey = this.generateCredentialUnlockKey();
    }
    return settings.credentialUnlockKey;
  }

  private generateCredentialUnlockKey(): string {
    const bytes = new Uint8Array(32);
    activeWindow.crypto.getRandomValues(bytes);
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return activeWindow.btoa(binary);
  }

  async resetLocalSyncState(databaseNameToClear = this.settings.couchDb.database): Promise<void> {
    this.scheduler?.cancel();
    this.clearVaultChangeBatchTimer();
    this.settings = {
      ...this.settings,
      remoteState: { ...DEFAULT_SETTINGS.remoteState },
      localQueue: { ...DEFAULT_SETTINGS.localQueue },
      localPreview: { ...DEFAULT_SETTINGS.localPreview },
      localStaging: { ...DEFAULT_SETTINGS.localStaging },
      localLiveApply: { ...DEFAULT_SETTINGS.localLiveApply },
      runtime: { ...DEFAULT_SETTINGS.runtime }
    };
    for (const store of this.localStores.values()) {
      store.close();
    }
    this.localStores.clear();
    await LocalDocumentStore.deleteDatabase(databaseNameToClear);
  }

  async promptForSetupUri(initialSetupUri = ""): Promise<void> {
    const result = await new SetupUriModal(this.app, initialSetupUri).openAndWait();
    if (!result) {
      return;
    }
    await this.importSetupUri(result.setupUri, result.passphrase);
  }

  async promptForDirectSetup(): Promise<void> {
    const result = await new DirectCouchDbSetupModal(this.app, {
      hostname: this.settings.couchDb.uri,
      database: this.settings.couchDb.database,
      username: this.settings.couchDb.username,
      password: "",
      passphrase: ""
    }).openAndWait();
    if (!result) {
      return;
    }
    await this.configureDirectCouchDb(result);
  }

  async copyCouchDbSetupCommandFromSettings(): Promise<void> {
    try {
      const command = buildCouchDbSetupCommand({
        hostname: this.settings.couchDb.uri,
        database: this.settings.couchDb.database,
        username: this.settings.couchDb.username,
        password: "",
        passphrase: ""
      });
      await navigator.clipboard.writeText(command);
      this.setStatus("CouchDB setup command copied");
      new Notice("CouchDB setup command copied. Fill any placeholder secrets before running it.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Could not copy CouchDB setup command: ${message}`);
      new Notice(`Could not copy CouchDB setup command: ${message}`, 9000);
    }
  }

  async generateSetupUriForAdditionalDevice(): Promise<void> {
    try {
      if (!(await this.ensureCredentialsUnlocked())) {
        return;
      }
      const setupUri = await generateAdditionalDeviceSetupUri(this.getRuntimeSettings());
      new GeneratedSetupUriModal(this.app, setupUri).open();
      this.setStatus("Add-device URI ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Setup URI generation failed: ${message}`);
      new Notice(`Setup URI generation failed: ${message}`, 9000);
    }
  }

  async configureDirectCouchDb(input: DirectCouchDbSetupInput): Promise<void> {
    try {
      await this.saveDirectSetupDraft(input);
      const nextSettings = settingsFromDirectCouchDbSetup(input);
      this.setStatus("Connecting CouchDB");

      const verification = await this.verifyDirectSetupWithTransportFallback(nextSettings);

      const sessionCredentials = credentialPayloadFromSettings(nextSettings);
      nextSettings.credentialStore = await this.encryptCredentialPayloadForSettings(nextSettings, sessionCredentials, nextSettings.passphrase);

      await this.resetLocalSyncState(nextSettings.couchDb.database);
      this.sessionCredentials = sessionCredentials;
      this.settings = nextSettings;
      await this.rememberSessionCredentials(sessionCredentials);
      await this.baselineRemoteCheckpoint(verification.inspection);
      await this.updateRemoteInspection(verification.inspection);

      this.setStatus(verification.statusMessage);
      new Notice(`Light-LiveSync connected with these credentials. ${verification.noticeMessage}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Direct CouchDB setup failed: ${message}`);
      new Notice(`Direct CouchDB setup failed: ${message}`, 12000);
    }
  }

  private async saveDirectSetupDraft(input: DirectCouchDbSetupInput): Promise<void> {
    const normalised = normaliseDirectCouchDbSetupInput(input);
    this.settings = {
      ...this.settings,
      configured: false,
      deviceSetupRole: "initial-device",
      couchDb: {
        ...this.settings.couchDb,
        uri: normalised.hostname,
        database: normalised.database,
        username: normalised.username,
        password: normalised.password
      },
      passphrase: ""
    };

    if (normalised.password) {
      const draftCredentials: CredentialPayload = {
        couchDbPassword: normalised.password,
        passphrase: ""
      };
      this.sessionCredentials = draftCredentials;
      this.settings.credentialStore = await this.encryptCredentialPayloadForSettings(this.settings, draftCredentials);
    }

    await this.saveSettingsAndReschedule();
  }

  private async verifyDirectSetupWithTransportFallback(settings: LightweightLiveSyncSettings) {
    try {
      return await verifyCouchDbConnection(new CouchDbClient(settings.couchDb), {
        allowDatabaseCreation: true,
        allowSyncParameterCreation: true
      });
    } catch (error) {
      if (!this.shouldRetryDirectSetupWithRequestApi(error, settings)) {
        throw error;
      }
      const fallbackSettings: LightweightLiveSyncSettings = {
        ...settings,
        couchDb: {
          ...settings.couchDb,
          useRequestApi: true
        }
      };
      this.setStatus("Retrying CouchDB through app request API");
      const verification = await verifyCouchDbConnection(new CouchDbClient(fallbackSettings.couchDb), {
        allowDatabaseCreation: true,
        allowSyncParameterCreation: true
      });
      settings.couchDb.useRequestApi = true;
      return verification;
    }
  }

  private shouldRetryDirectSetupWithRequestApi(error: unknown, settings: LightweightLiveSyncSettings): boolean {
    if (settings.couchDb.useRequestApi || typeof requestUrl !== "function") {
      return false;
    }
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof CouchDbClientError ? error.status : undefined;
    return status === 401 || status === 403 || /CouchDB request could not be sent|Could not reach CouchDB|Failed to fetch/i.test(message);
  }

  async importSetupUri(uriOrPayload: string, passphrase: string): Promise<void> {
    try {
      const upstreamSettings = await decodeSettingsFromSetupUri(uriOrPayload, passphrase);
      const nextSettings = settingsFromUpstreamSetup(upstreamSettings);
      const credentialPayload = credentialPayloadFromSettings(nextSettings);
      if (hasCredentialPayload(credentialPayload) && passphrase) {
        nextSettings.credentialStore = await this.encryptCredentialPayloadForSettings(nextSettings, credentialPayload, passphrase);
        this.sessionCredentials = credentialPayload;
      }
      this.settings = nextSettings;
      if (nextSettings.credentialStore && hasCredentialPayload(credentialPayload)) {
        await this.rememberSessionCredentials(credentialPayload);
      }
      await this.saveSettingsAndReschedule();
      this.setStatus("Setup URI imported");
      new Notice("Light-LiveSync setup imported.");
      if (this.canRunAutomaticSync()) {
        this.scheduler.request("setup-import", true);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Setup URI import failed: ${message}`);
      new Notice(`Setup URI import failed: ${message}`, 12000);
    }
  }

  async importSetupQr(qrOrPayload: string): Promise<void> {
    try {
      const upstreamSettings = decodeSettingsFromSetupQr(qrOrPayload);
      const nextSettings = settingsFromUpstreamSetup(upstreamSettings);
      const credentialPayload = credentialPayloadFromSettings(nextSettings);
      if (hasCredentialPayload(credentialPayload)) {
        nextSettings.credentialStore = await this.encryptCredentialPayloadForSettings(nextSettings, credentialPayload, "");
        this.sessionCredentials = credentialPayload;
      }
      this.settings = nextSettings;
      if (hasCredentialPayload(credentialPayload)) {
        await this.rememberSessionCredentials(credentialPayload);
      }
      await this.saveSettingsAndReschedule();
      this.setStatus("Setup QR imported");
      new Notice("Light-LiveSync QR setup imported.");
      if (this.canRunAutomaticSync()) {
        this.scheduler.request("setup-qr-import", true);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Setup QR import failed: ${message}`);
      new Notice(`Setup QR import failed: ${message}`, 12000);
    }
  }

  private registerCommands(): void {
    for (const command of this.commandSpecs()) {
      this.addCommand(command);
    }
  }

  private commandSpecs(): CommandSpec[] {
    return [
      { id: "sync-now", name: "Sync now", callback: () => void this.syncNow() },
      { id: "prepare-couchdb-setup-command", name: "Prepare CouchDB setup command", callback: () => void this.promptForDirectSetup() },
      { id: "use-setup-uri", name: "Use setup URI", callback: () => void this.promptForSetupUri() },
      {
        id: "generate-setup-uri-for-additional-device",
        name: "Generate setup URI for another device",
        callback: () => void this.generateSetupUriForAdditionalDevice()
      },
      {
        id: "initialize-remote-sync-parameters",
        name: "Initialize remote sync parameters",
        callback: () => void this.initializeRemoteSyncParameters()
      },
      { id: "check-couchdb-connection", name: "Check CouchDB connection", callback: () => void this.verifyConnectionNow() },
      { id: "write-runtime-evidence-report", name: "Write runtime evidence report", callback: () => void this.writeRuntimeEvidenceReport() },
      { id: "run-session-cache-self-check", name: "Run session credential cache self-check", callback: () => void this.runSessionCredentialCacheSelfCheck() },
      { id: "prepare-session-cache-reload-check", name: "Prepare session credential cache reload check", callback: () => void this.prepareSessionCredentialCacheReloadCheck() },
      { id: "finish-session-cache-reload-check", name: "Finish session credential cache reload check", callback: () => void this.finishSessionCredentialCacheReloadCheck() },
      { id: "prepare-real-session-cache-reload-check", name: "Prepare real credential reload check", callback: () => void this.prepareRealSessionCredentialReloadCheck() },
      { id: "finish-real-session-cache-reload-check", name: "Finish real credential reload check", callback: () => void this.finishRealSessionCredentialReloadCheck() },
      { id: "update-credentials", name: "Update credentials", callback: () => void this.promptForServerCredentials() },
      { id: "preview-queued-pull", name: "Preview queued pull", callback: () => void this.previewQueuedPull() },
      { id: "export-pull-preview", name: "Export pull preview", callback: () => void this.exportPullPreview() },
      {
        id: "apply-pull-to-staging",
        name: "Apply pull to staging folder",
        callback: () => void this.applyPullToStaging()
      },
      { id: "apply-pull-to-vault", name: "Apply pull to vault", callback: () => void this.applyPullToVault() }
    ];
  }

  async unlockCredentials(): Promise<boolean> {
    if (!this.settings.credentialStore) {
      new Notice("No encrypted credentials are stored.");
      return true;
    }

    if (!credentialsAreLocked(this.getRuntimeSettings())) {
      new Notice("Credentials are ready on this device.");
      return true;
    }

    if (await this.restorePersistentCredentials()) {
      await this.rememberSessionCredentials(this.sessionCredentials as CredentialPayload);
      this.setStatus("Credentials ready");
      new Notice("Light-LiveSync credentials are ready on this device.");
      if (this.settings.localQueue.pendingPush > 0) {
        this.scheduler.request("vault-change");
      }
      return true;
    }

    new Notice("Saved credentials could not be opened automatically. Update saved credentials once to refresh this device.");
    return false;
  }

  async promptForServerCredentials(): Promise<void> {
    const result = await new ServerCredentialsModal(this.app).openAndWait();
    if (!result) {
      return;
    }
    this.settings.autoUnlockCredentials = true;
    this.settings.keepUnlockedDuringSession = true;
    this.settings = applyCredentialPayload(this.settings, result.credentials);
    this.sessionCredentials = result.credentials;
    this.settings.credentialStore = await this.encryptCredentialPayloadForSettings(this.settings, result.credentials);
    this.settings.configured = !!this.settings.couchDb.uri && !!this.settings.couchDb.database;
    await this.rememberSessionCredentials(result.credentials);
    await this.saveSettingsAndReschedule();
    this.setStatus("Credentials updated");
    new Notice("Credentials saved encrypted.");
  }

  async clearActivityLog(): Promise<void> {
    this.settings = {
      ...this.settings,
      runtime: {
        ...this.settings.runtime,
        activityLog: []
      }
    };
    await this.saveSettingsAndReschedule();
    this.setStatus("Activity log cleared");
  }

  async listRecoveryBackups(limit = 10): Promise<RecoveryBackupEntry[]> {
    return listRecoveryBackups(this.app.vault.adapter, this.conflictFolder(), limit);
  }

  async restoreRecoveryBackup(entry: RecoveryBackupEntry): Promise<void> {
    try {
      const result = await restoreRecoveryBackup(this.app.vault.adapter, entry, this.conflictFolder());
      this.queueVaultPath(result.restoredPath);
      const backupMessage = result.createdPreRestoreBackup
        ? ` A fresh backup of the replaced file was kept at ${result.preRestoreBackupPath}.`
        : "";
      this.log(`Recovered ${result.restoredPath} from ${entry.backupPath}.${backupMessage}`);
      this.setStatus("Recovered backup");
      new Notice(`Recovered ${result.restoredPath}.${backupMessage}`, 12000);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Recovery restore failed: ${message}`);
      new Notice(`Recovery restore failed: ${message}`, 12000);
    }
  }

  async listFileVersions(path: string): Promise<FileVersionEntry[]> {
    if (!this.settings.configured || !hasUsableRemote(this.settings)) {
      throw new Error("Light-LiveSync is not configured.");
    }
    if (!(await this.ensureCredentialsUnlocked())) {
      throw new Error("Saved credentials could not be opened automatically.");
    }
    const runtimeSettings = this.getRuntimeSettings();
    const normalizedPath = normalizePath(path).replace(/^\/+/, "");
    const client = new CouchDbClient(runtimeSettings.couchDb);
    const versions = await listFileVersions(
      client,
      normalizedPath,
      this.documentTransformOptions(),
      runtimeSettings.usePathObfuscation
    );
    this.log(`Version history check for ${normalizedPath}: found ${versions.length} saved version${versions.length === 1 ? "" : "s"}.`);
    return versions;
  }

  async listRecentlyDeletedFileVersions(limit = 20): Promise<DeletedFileVersionEntry[]> {
    if (!this.settings.configured || !hasUsableRemote(this.settings)) {
      throw new Error("Light-LiveSync is not configured.");
    }
    if (!(await this.ensureCredentialsUnlocked())) {
      throw new Error("Saved credentials could not be opened automatically.");
    }
    const client = new CouchDbClient(this.getRuntimeSettings().couchDb);
    const deletedVersions = await listRecentlyDeletedFileVersions(
      client,
      this.app.vault.adapter,
      this.documentTransformOptions(),
      limit
    );
    this.log(`Recently deleted recovery check: found ${deletedVersions.length} file${deletedVersions.length === 1 ? "" : "s"} with saved versions.`);
    return deletedVersions;
  }

  async restoreFileVersion(entry: FileVersionEntry): Promise<void> {
    try {
      if (!(await this.ensureCredentialsUnlocked())) {
        return;
      }
      const client = new CouchDbClient(this.getRuntimeSettings().couchDb);
      const result = await restoreFileVersion(
        client,
        this.app.vault.adapter,
        entry.id,
        this.documentTransformOptions(),
        this.conflictFolder()
      );
      this.queueVaultPath(result.restoredPath);
      const backupMessage = result.createdPreRestoreBackup
        ? ` A backup of the replaced file was kept at ${result.preRestoreBackupPath}.`
        : "";
      this.log(`Recovered ${result.restoredPath} from version saved ${new Date(entry.createdAt).toLocaleString()}.${backupMessage}`);
      this.setStatus("Recovered version");
      new Notice(`Recovered ${result.restoredPath}.${backupMessage}`, 12000);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Version recovery failed: ${message}`);
      new Notice(`Version recovery failed: ${message}`, 12000);
    }
  }

  async syncNow(): Promise<void> {
    if (!(await this.ensureCredentialsUnlocked())) {
      return;
    }
    if (await this.shouldManualSyncPullBeforeFullVaultScan()) {
      this.log("Manual sync will pull the existing remote vault before uploading this additional device's local files.");
    } else {
      await this.queueCurrentVaultForSync("Manual sync");
    }
    this.scheduler.request("manual", true);
  }

  async verifyConnectionNow(): Promise<void> {
    try {
      if (!this.settings.configured || !this.settings.couchDb.uri || !this.settings.couchDb.database) {
        new Notice("Connect CouchDB before checking the connection.");
        return;
      }
      if (!(await this.ensureCredentialsUnlocked())) {
        return;
      }

      this.setStatus("Checking CouchDB");
      const canPrepareRemote = this.getRuntimeSettings().deviceSetupRole === "initial-device";
      const verification = await verifyCouchDbConnection(new CouchDbClient(this.getRuntimeSettings().couchDb), {
        allowDatabaseCreation: canPrepareRemote,
        allowSyncParameterCreation: canPrepareRemote
      });
      await this.updateRemoteInspection(verification.inspection);
      this.setStatus(verification.statusMessage);
      new Notice(verification.noticeMessage);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`CouchDB connection check failed: ${message}`);
      new Notice(`CouchDB connection check failed: ${message}`, 12000);
    }
  }

  runRuntimeSmokeCheck(): void {
    const report = buildRuntimeSmokeCheckReport({
      manifest: this.manifest,
      settings: this.getRuntimeSettings(),
      workerScriptAvailable: this.workerSourceAvailable()
    });
    this.setStatus(report.ok ? "Runtime check passed" : "Runtime check needs attention");
    new Notice(report.message);
    this.log(report.message);
    for (const detail of report.details) {
      this.log(`Runtime check: ${detail}`);
    }
  }

  private async runAutomaticRuntimeCheck(): Promise<void> {
    const smoke = buildRuntimeSmokeCheckReport({
      manifest: this.manifest,
      settings: this.getRuntimeSettings(),
      workerScriptAvailable: this.workerSourceAvailable()
    });
    const capability = buildRuntimeCapabilityReport({
      manifest: this.manifest,
      settings: this.getRuntimeSettings(),
      snapshot: await this.buildRuntimeCapabilitySnapshot()
    });
    const ok = smoke.ok && capability.ok;
    this.log(`Automatic runtime check: ${ok ? "passed" : "needs attention"}. Local uploads waiting: ${this.settings.localQueue.pendingPush}; remote files waiting: ${this.settings.localQueue.pendingApply}.`);
    if (!ok) {
      this.log(`Automatic runtime check issue: ${smoke.message} ${capability.message}`);
      for (const detail of [...smoke.details, ...capability.details]) {
        this.log(`Automatic runtime check detail: ${detail}`);
      }
    }
    if (!ok) {
      this.setStatus("Runtime check needs attention");
    }
  }

  async runRuntimeCapabilityCheck(): Promise<void> {
    const report = buildRuntimeCapabilityReport({
      manifest: this.manifest,
      settings: this.getRuntimeSettings(),
      snapshot: await this.buildRuntimeCapabilitySnapshot()
    });
    this.setStatus(report.ok ? "Capability check passed" : "Capability check needs attention");
    new Notice(report.message);
    this.log(report.message);
    for (const detail of report.details) {
      this.log(`Capability check: ${detail}`);
    }
  }

  async writeRuntimeEvidenceReport(): Promise<void> {
    const capability = buildRuntimeCapabilityReport({
      manifest: this.manifest,
      settings: this.getRuntimeSettings(),
      snapshot: await this.buildRuntimeCapabilitySnapshot()
    });
    const smoke = buildRuntimeSmokeCheckReport({
      manifest: this.manifest,
      settings: this.getRuntimeSettings(),
      workerScriptAvailable: this.workerSourceAvailable()
    });
    const generatedAt = Date.now();
    const content = formatRuntimeEvidenceReport({
      generatedAt,
      platform: this.runtimePlatformLabel(),
      manifest: this.manifest,
      settings: this.getRuntimeSettings(),
      smoke,
      capability
    });
    const folderPath = normalizePath(RUNTIME_EVIDENCE_FOLDER);
    const filePath = normalizePath(runtimeEvidenceReportPath(generatedAt));
    if (!this.app.vault.getAbstractFileByPath(folderPath)) {
      await this.app.vault.createFolder(folderPath);
    }
    await this.app.vault.create(filePath, content);
    this.setStatus(capability.ok && smoke.ok ? "Evidence report written" : "Evidence report needs attention");
    new Notice(`Light-LiveSync evidence report written to ${filePath}.`);
    this.log(`Runtime evidence report written: ${filePath}`);
  }

  private runtimePlatformLabel(): string {
    if (Platform.isMobile) {
      return "mobile";
    }
    if (Platform.isDesktopApp) {
      return "desktop";
    }
    return "unknown";
  }

  private async buildRuntimeCapabilitySnapshot(): Promise<RuntimeCapabilitySnapshot> {
    return {
      webCrypto: await this.checkWebCrypto(),
      sessionStorage: this.checkSessionStorage(),
      indexedDb: await this.checkIndexedDb(),
      fetch: typeof activeWindow.fetch === "function",
      abortController: "AbortController" in activeWindow,
      textCodec: "TextEncoder" in activeWindow && "TextDecoder" in activeWindow,
      base64Codec: typeof activeWindow.btoa === "function" && typeof activeWindow.atob === "function",
      workerConstructor: "Worker" in activeWindow,
      workerScriptAvailable: this.workerSourceAvailable(),
      obsidianRequestApi: typeof requestUrl === "function"
    };
  }

  private async checkWebCrypto(): Promise<boolean> {
    try {
      const bytes = new Uint8Array(4);
      activeWindow.crypto.getRandomValues(bytes);
      await activeWindow.crypto.subtle.digest("SHA-256", bytes);
      return true;
    } catch {
      return false;
    }
  }

  private checkSessionStorage(): boolean {
    const key = `${this.manifest.id}:capability-check`;
    try {
      activeWindow.sessionStorage.setItem(key, "ok");
      const ok = activeWindow.sessionStorage.getItem(key) === "ok";
      activeWindow.sessionStorage.removeItem(key);
      return ok;
    } catch {
      return false;
    }
  }

  private async checkIndexedDb(): Promise<boolean> {
    const indexedDb = activeWindow.indexedDB;
    if (!indexedDb) {
      return false;
    }

    const name = `${this.manifest.id}-capability-check`;
    try {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDb.open(name, 1);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed."));
        request.onupgradeneeded = () => {
          request.result.createObjectStore("probe");
        };
        request.onsuccess = () => resolve(request.result);
      });
      database.close();
      await new Promise<void>((resolve) => {
        const deleteRequest = indexedDb.deleteDatabase(name);
        deleteRequest.onsuccess = () => resolve();
        deleteRequest.onerror = () => resolve();
        deleteRequest.onblocked = () => resolve();
      });
      return true;
    } catch {
      return false;
    }
  }

  async runSessionCredentialCacheSelfCheck(): Promise<void> {
    const scope = this.sessionCacheSelfCheckScope();
    const payload = this.sessionCacheSelfCheckPayload();

    try {
      clearSessionCredentialPayload(scope);
      const saved = await saveSessionCredentialPayload(scope, payload);
      if (!saved) {
        throw new Error("Session storage or WebCrypto is unavailable in this runtime.");
      }

      const restored = await loadSessionCredentialPayload(scope);
      if (
        restored?.couchDbPassword !== payload.couchDbPassword ||
        restored.passphrase !== payload.passphrase
      ) {
        throw new Error("The session credential token did not restore correctly.");
      }

      const wrongScope = await loadSessionCredentialPayload({ ...scope, database: "wrong-database" });
      if (wrongScope) {
        throw new Error("The session credential token was accepted for the wrong database scope.");
      }

      clearSessionCredentialPayload(scope);
      if (await loadSessionCredentialPayload(scope)) {
        throw new Error("The session credential token remained after clear.");
      }

      this.setStatus("Session cache check passed");
      new Notice("Session credential cache self-check passed.");
      this.log("Session credential cache self-check passed with dummy credentials.");
    } catch (error) {
      clearSessionCredentialPayload(scope);
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus("Session cache check failed");
      new Notice(`Session credential cache self-check failed: ${message}`);
      this.log(`Session credential cache self-check failed: ${message}`);
    }
  }

  async prepareSessionCredentialCacheReloadCheck(): Promise<void> {
    const scope = this.sessionCacheReloadCheckScope();
    try {
      clearSessionCredentialPayload(scope);
      const saved = await saveSessionCredentialPayload(scope, this.sessionCacheReloadCheckPayload());
      if (!saved) {
        throw new Error("Session storage or WebCrypto is unavailable in this runtime.");
      }
      this.setStatus("Reload cache check prepared");
      new Notice("Session credential cache reload check prepared. Reload Obsidian, then run Finish session credential cache reload check.");
      this.log("Prepared session credential cache reload check with dummy credentials.");
    } catch (error) {
      clearSessionCredentialPayload(scope);
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus("Reload cache check failed");
      new Notice(`Could not prepare session credential cache reload check: ${message}`);
      this.log(`Could not prepare session credential cache reload check: ${message}`);
    }
  }

  async finishSessionCredentialCacheReloadCheck(): Promise<void> {
    const scope = this.sessionCacheReloadCheckScope();
    try {
      const restored = await loadSessionCredentialPayload(scope);
      const expected = this.sessionCacheReloadCheckPayload();
      if (
        restored?.couchDbPassword !== expected.couchDbPassword ||
        restored.passphrase !== expected.passphrase
      ) {
        throw new Error("The reload-check token was not available after renderer reload.");
      }

      clearSessionCredentialPayload(scope);
      if (await loadSessionCredentialPayload(scope)) {
        throw new Error("The reload-check token remained after clear.");
      }

      this.setStatus("Reload cache check passed");
      new Notice("Session credential cache reload check passed.");
      this.log("Session credential cache reload check passed with dummy credentials.");
    } catch (error) {
      clearSessionCredentialPayload(scope);
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus("Reload cache check failed");
      new Notice(`Session credential cache reload check failed: ${message}`);
      this.log(`Session credential cache reload check failed: ${message}`);
    }
  }

  async prepareRealSessionCredentialReloadCheck(): Promise<void> {
    const scope = this.sessionCredentialScope();
    try {
      if (!this.settings.keepUnlockedDuringSession) {
        throw new Error("Session credential cache is disabled in settings.");
      }
      if (!(await this.ensureCredentialsUnlocked())) {
        return;
      }

      const payload = this.sessionCredentials ?? credentialPayloadFromSettings(this.getRuntimeSettings());
      if (!hasCredentialPayload(payload)) {
        throw new Error("No ready CouchDB password and E2EE passphrase are available to check.");
      }

      const savedToken = await saveSessionCredentialPayload(scope, payload);
      const savedProof = await saveSessionCredentialReloadProof(scope, payload);
      if (!savedToken || !savedProof) {
        throw new Error("Session storage or WebCrypto is unavailable in this runtime.");
      }

      this.setStatus("Real reload check prepared");
      new Notice("Real credential reload check prepared. Reload Obsidian, then run Finish real credential reload check.");
      this.log("Prepared real session credential reload check without writing plaintext credentials to plugin data.");
    } catch (error) {
      clearSessionCredentialReloadProof(scope);
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus("Real reload check failed");
      new Notice(`Could not prepare real credential reload check: ${message}`);
      this.log(`Could not prepare real credential reload check: ${message}`);
    }
  }

  async finishRealSessionCredentialReloadCheck(): Promise<void> {
    const scope = this.sessionCredentialScope();
    try {
      if (!this.sessionCredentials) {
        await this.restoreSessionCredentials();
      }
      const payload = this.sessionCredentials;
      if (!payload || !hasCredentialPayload(payload)) {
        throw new Error("Credentials were not restored into memory after reload.");
      }

      const proof = await verifySessionCredentialReloadProof(scope, payload);
      if (proof !== "matched") {
        throw new Error(
          proof === "missing"
            ? "No prepared real credential reload proof was found."
            : proof === "unavailable"
              ? "Session storage or WebCrypto is unavailable in this runtime."
              : "The restored credentials did not match the prepared reload proof."
        );
      }

      clearSessionCredentialReloadProof(scope);
      this.settings = applyCredentialPayload(this.settings, payload);
      await this.saveSettingsAndReschedule();
      this.setStatus("Real reload check passed");
      new Notice("Real credential reload check passed. Credentials restored for this Obsidian session.");
      this.log("Real session credential reload check passed without exposing plaintext credentials.");
    } catch (error) {
      clearSessionCredentialReloadProof(scope);
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus("Real reload check failed");
      new Notice(`Real credential reload check failed: ${message}`);
      this.log(`Real credential reload check failed: ${message}`);
    }
  }

  private sessionCacheSelfCheckScope(): SessionCredentialScope {
    return {
      ...this.sessionCredentialScope(),
      uri: "self-check://session-cache",
      database: "session-cache-self-check",
      username: "self-check"
    };
  }

  private sessionCacheSelfCheckPayload(): CredentialPayload {
    return {
      couchDbPassword: "dummy-session-cache-password",
      passphrase: "dummy-session-cache-passphrase"
    };
  }

  private sessionCacheReloadCheckScope(): SessionCredentialScope {
    return {
      ...this.sessionCredentialScope(),
      uri: "self-check://session-cache-reload",
      database: "session-cache-reload-check",
      username: "self-check"
    };
  }

  private sessionCacheReloadCheckPayload(): CredentialPayload {
    return {
      couchDbPassword: "dummy-session-cache-reload-password",
      passphrase: "dummy-session-cache-reload-passphrase"
    };
  }

  async initializeRemoteSyncParameters(): Promise<void> {
    try {
      if (this.getRuntimeSettings().deviceSetupRole === "additional-device") {
        new Notice("This device was added by setup URI. Initialize the remote database from the original device instead.");
        return;
      }
      if (!(await this.ensureCredentialsUnlocked())) {
        return;
      }
      const outcome = await this.engine.initialiseRemote();
      this.setStatus(outcome.message);
      new Notice(outcome.message);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Remote initialisation failed: ${message}`);
      new Notice(`Remote initialisation failed: ${message}`);
    }
  }

  async previewQueuedPull(): Promise<void> {
    try {
      const context = await this.preparePullOperation("previewing");
      if (!context) {
        return;
      }

      const summary = await context.reconstructor.previewPending(10);
      await this.updateLocalPreview(summary);
      const message = `Previewed ${summary.checked}. Ready: ${summary.ready}. Missing chunks: ${summary.missingChunks}. Encrypted: ${summary.encryptedUnsupported}.`;
      this.setStatus(message);
      new Notice(message);
      this.logPreviewSummary(summary);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Preview queued pull failed: ${message}`);
      new Notice(`Preview queued pull failed: ${message}`);
    }
  }

  private async exportPullPreview(): Promise<void> {
    try {
      const context = await this.preparePullOperation("exporting");
      if (!context) {
        return;
      }

      const summary = await context.reconstructor.previewPending(10);
      await this.updateLocalPreview(summary);
      const basePath = this.previewExportFolder();
      const result = await exportReadyPreviews(this.app.vault, basePath, summary.previews);
      const message = `Exported ${result.exported} preview files. Skipped: ${result.skipped}.`;
      this.setStatus(message);
      new Notice(message);
      this.log(`Preview export folder: ${result.basePath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Export pull preview failed: ${message}`);
      new Notice(`Export pull preview failed: ${message}`);
    }
  }

  private async applyPullToStaging(): Promise<void> {
    try {
      const context = await this.preparePullOperation("applying");
      if (!context) {
        return;
      }

      const summary = await context.reconstructor.previewPendingStaging(this.applyBatchLimit());
      await this.updateLocalPreview(summary);
      const result = await applyReadyPreviewsToStaging(
        this.app.vault,
        this.stagingApplyFolder(),
        summary.previews
      );
      await context.store.markStaged(result.stagedIds);
      await this.updateLocalStaging(result);
      await this.updateLocalQueue(await context.store.getSummary());
      const message = `Staged ${result.staged}. Skipped: ${result.skipped}. Failed: ${result.failed}.`;
      this.setStatus(message);
      new Notice(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Apply pull to staging failed: ${message}`);
      new Notice(`Apply pull to staging failed: ${message}`);
    }
  }

  async applyPullToVault(): Promise<void> {
    try {
      const context = await this.preparePullOperation("applying");
      if (!context) {
        return;
      }

      const result = await this.applyPreviewBatchToVault(context, this.applyBatchLimit());
      const message = `Applied ${result.applied}. Merged: ${result.merged}. Deleted: ${result.deleted}. Backups: ${result.backedUp}. Conflicts: ${result.conflicted}. Failed: ${result.failed}.`;
      this.setStatus(message);
      new Notice(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Apply pull to vault failed: ${message}`);
      new Notice(`Apply pull to vault failed: ${message}`);
    }
  }

  private async ensureCredentialsUnlocked(): Promise<boolean> {
    if (!credentialsAreLocked(this.getRuntimeSettings())) {
      return true;
    }
    if (await this.restorePersistentCredentials()) {
      return true;
    }
    new Notice("Saved credentials could not be opened automatically. Update saved credentials once to refresh this device.");
    return false;
  }

  private async preparePullOperation(action: "previewing" | "exporting" | "applying"): Promise<PullOperationContext | undefined> {
    if (!this.settings.configured || !this.settings.couchDb.database) {
      new Notice(`Import a setup URI before ${action} the pull queue.`);
      return undefined;
    }
    const settings = this.getRuntimeSettings();
    if ((settings.encrypt || settings.requireE2EE) && !(await this.ensureCredentialsUnlocked())) {
      return undefined;
    }

    const store = this.getLocalStore(this.settings.couchDb.database);
    const client = new CouchDbClient(settings.couchDb);
    return {
      store,
      reconstructor: new DocumentReconstructor(store, this.documentTransformOptions(), {
        yieldToUi: () => this.yieldToUi(),
        loadMissingChunks: (ids) => this.loadAndCacheMissingChunks(store, client, ids)
      })
    };
  }

  private async applyPulledChanges(databaseName: string, client?: SyncRemoteClient): Promise<LiveVaultApplyResult> {
    const store = this.getLocalStore(databaseName);
    const remoteClient = client ?? new CouchDbClient(this.getRuntimeSettings().couchDb);
    const context: PullOperationContext = {
      store,
      reconstructor: new DocumentReconstructor(store, this.documentTransformOptions(), {
        yieldToUi: () => this.yieldToUi(),
        loadMissingChunks: (ids) => this.loadAndCacheMissingChunks(store, remoteClient, ids)
      })
    };
    const result = await this.applyPreviewBatchToVault(context, this.applyBatchLimit());
    if (hasLiveApplyActivity(result)) {
      this.log(
        `Auto-applied pulled changes. Applied ${result.applied}, merged ${result.merged}, deleted ${result.deleted}, skipped ${result.skipped}, waiting ${result.waiting}, backups ${result.backedUp}, conflicts ${result.conflicted}, failed ${result.failed}.${applyReasonSummary("Waiting", result.waitingReasons)}${applyReasonSummary("Skipped", result.skippedReasons)}${applyReasonSummary("Failed", result.failedReasons)}`
      );
    }
    return result;
  }

  private async loadAndCacheMissingChunks(
    store: LocalDocumentStore,
    client: Pick<SyncRemoteClient, "getDocumentsByIds">,
    ids: string[]
  ): Promise<Map<string, LiveSyncChunkDocument>> {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (uniqueIds.length === 0) {
      return new Map();
    }

    const found = new Map<string, LiveSyncChunkDocument>();
    const batchSize = Math.max(1, Math.min(50, Math.round(this.settings.maxStorageApplyConcurrency || DEFAULT_SETTINGS.maxStorageApplyConcurrency)));
    for (let index = 0; index < uniqueIds.length; index += batchSize) {
      await this.yieldToUi();
      const batch = uniqueIds.slice(index, index + batchSize);
      const docs = await client.getDocumentsByIds(batch);
      const chunks = [...docs.values()].filter(isLiveSyncChunkDocument);
      await store.cacheRemoteDocuments(chunks);
      for (const chunk of chunks) {
        found.set(chunk._id, chunk);
      }
      await this.yieldToUi();
    }

    if (found.size > 0 || uniqueIds.length > 0) {
      const missing = uniqueIds.length - found.size;
      this.log(
        `Recovered ${found.size} missing content chunk${found.size === 1 ? "" : "s"} from CouchDB for pending remote files${missing > 0 ? `; ${missing} chunk${missing === 1 ? "" : "s"} still missing on the server` : ""}.`
      );
    }
    return found;
  }

  private async applyPreviewBatchToVault(
    context: PullOperationContext,
    limit: number
  ): Promise<LiveVaultApplyResult> {
    const summary = await context.reconstructor.previewPending(limit);
    await this.updateLocalPreview(summary);
    const result = await this.withSuppressedVaultEvents(() => applyReadyPreviewsToLiveVault(this.app.vault, summary.previews, {
      configDir: this.app.vault.configDir,
      conflictFolder: this.conflictFolder(),
      shouldApplyPath: (path) => this.shouldSyncPath(path),
      deferApplyPath: (path) => this.deferMobileReloadSensitiveApplyPath(path),
      yieldToUi: () => this.yieldToUi()
    }));
    await context.store.markApplied([...result.appliedIds, ...result.skippedIds]);
    if (result.preservedLocalSettingsPaths.length > 0) {
      await context.store.queueLocalChanges(result.preservedLocalSettingsPaths.map((path) => ({
        path,
        deleted: false
      })));
      this.log(
        `Preserved local secret-like values in ${result.preservedLocalSettingsPaths.length} synced settings file${result.preservedLocalSettingsPaths.length === 1 ? "" : "s"} and queued the repaired settings for upload.`
      );
    }
    await this.updateLocalLiveApply(result);
    await this.promptForDeferredMobileReloadSensitiveApply();
    await this.refreshObsidianAfterSyncedConfigChanges(result.changedPaths);
    await this.updateLocalQueue(await context.store.getSummary());
    return result;
  }

  private deferMobileReloadSensitiveApplyPath(path: string): string | undefined {
    const normalized = normalizePath(path);
    if (!Platform.isMobile) {
      return undefined;
    }
    if (this.approvedMobileReloadSensitiveApplyPaths.has(normalized)) {
      return undefined;
    }
    const plan = planObsidianConfigRefresh([normalized], this.app.vault.configDir, this.manifest.id);
    if (!shouldPromptForAppReload(plan, true)) {
      return undefined;
    }
    this.pendingMobileReloadSensitiveApplyPaths.add(normalized);
    return "Waiting for approval before applying plugin files that can reload the mobile app.";
  }

  private async promptForDeferredMobileReloadSensitiveApply(): Promise<void> {
    if (!Platform.isMobile || this.pendingMobileReloadSensitiveApplyPaths.size === 0) {
      return;
    }
    const paths = [...this.pendingMobileReloadSensitiveApplyPaths].sort((left, right) => left.localeCompare(right));
    const plan = planObsidianConfigRefresh(paths, this.app.vault.configDir, this.manifest.id);
    const applyNow = await this.promptForPluginReload(plan, paths, true);
    if (!applyNow) {
      this.log(
        `Paused ${paths.length} synced plugin/config update${paths.length === 1 ? "" : "s"} on mobile because applying them can reload the app. Notes, attachments, and settings data can continue syncing.`
      );
      return;
    }

    for (const path of paths) {
      this.approvedMobileReloadSensitiveApplyPaths.add(path);
    }
    this.mobileReloadAfterApprovedApply = true;
    this.pendingMobileReloadSensitiveApplyPaths.clear();
    this.lastPluginReloadPromptKey = "";
    this.log("Synced plugin/config updates approved. Applying them in the next sync pass, then the app will reload if needed.");
    window.setTimeout(() => {
      this.scheduler.request("vault-change", true);
    }, 0);
  }

  private async refreshObsidianAfterSyncedConfigChanges(changedPaths: string[]): Promise<void> {
    const plan = planObsidianConfigRefresh(changedPaths, this.app.vault.configDir, this.manifest.id);
    const hasWork =
      plan.communityPluginsChanged ||
      plan.appSettingsChanged.length > 0 ||
      plan.pluginsToReload.length > 0 ||
      plan.ownPluginChanged;
    if (!hasWork) {
      return;
    }

    if (plan.appSettingsChanged.length > 0) {
      this.notifyObsidianSettingsChanged(plan.appSettingsChanged);
    }
    if (shouldAutoApplyPluginRefresh(plan, Platform.isMobile)) {
      this.queueDeferredObsidianPluginRefresh(changedPaths);
    } else if (plan.communityPluginsChanged || plan.pluginsToReload.length > 0) {
      this.log("Synced community plugin changes were written. Automatic plugin reload is paused on mobile to avoid app reload loops.");
    }
    if (Platform.isMobile && this.mobileReloadAfterApprovedApply && shouldPromptForAppReload(plan, true)) {
      this.mobileReloadAfterApprovedApply = false;
      this.approvedMobileReloadSensitiveApplyPaths.clear();
      this.log("Reloading the app after applying approved synced plugin/config updates.");
      window.setTimeout(() => {
        window.location.reload();
      }, 100);
      return;
    }
    if (shouldPromptForAppReload(plan, Platform.isMobile)) {
      const reloadNow = await this.promptForPluginReload(plan, changedPaths, false);
      if (reloadNow) {
        this.log("Reloading the app after synced plugin changes, as requested.");
        window.setTimeout(() => {
          window.location.reload();
        }, 100);
      }
    } else if (plan.ownPluginChanged) {
      this.log("Synced Light-LiveSync plugin files changed. Reload the app or disable/enable Light-LiveSync to use the new plugin bundle.");
    }
  }

  private async promptForPluginReload(
    plan: ReturnType<typeof planObsidianConfigRefresh>,
    changedPaths: string[],
    pendingApply: boolean
  ): Promise<boolean> {
    const promptKey = [
      pendingApply ? "pending" : "written",
      plan.communityPluginsChanged ? "community" : "",
      plan.ownPluginChanged ? "own" : "",
      ...plan.pluginsToReload,
      ...changedPaths.map((path) => normalizePath(path)).sort()
    ].filter(Boolean).join("|");
    if (!promptKey || this.lastPluginReloadPromptKey === promptKey) {
      return false;
    }
    this.lastPluginReloadPromptKey = promptKey;

    const reloadNow = await new PluginReloadPromptModal(this.app, {
      changedPluginCount: plan.pluginsToReload.length,
      communityPluginListChanged: plan.communityPluginsChanged,
      ownPluginChanged: plan.ownPluginChanged,
      pendingApply
    }).openAndWait();
    if (!reloadNow) {
      this.log("Synced plugin changes are ready. Reload later from the prompt or restart the app when convenient.");
      return false;
    }

    return true;
  }

  private notifyObsidianSettingsChanged(paths: string[]): void {
    const workspace = this.app.workspace as unknown as { trigger?: (name: string) => void };
    workspace.trigger?.("layout-change");
    this.log(`Synced Obsidian settings updated: ${paths.join(", ")}.`);
  }

  private queueDeferredObsidianPluginRefresh(changedPaths: string[]): void {
    for (const path of changedPaths) {
      this.pendingObsidianPluginRefreshPaths.add(path);
    }
    this.obsidianPluginRefreshAttempts = 0;
    this.scheduleDeferredObsidianPluginRefresh(this.deferredObsidianPluginRefreshDelayMs());
  }

  private deferredObsidianPluginRefreshDelayMs(): number {
    if (this.layoutReadyAt <= 0) {
      return OBSIDIAN_PLUGIN_REFRESH_DELAY_MS;
    }
    return Math.max(1000, OBSIDIAN_PLUGIN_REFRESH_DELAY_MS - (Date.now() - this.layoutReadyAt));
  }

  private scheduleDeferredObsidianPluginRefresh(delayMs: number): void {
    this.clearObsidianPluginRefreshTimer();
    this.obsidianPluginRefreshTimer = window.setTimeout(() => {
      void this.runDeferredObsidianPluginRefresh();
    }, delayMs);
    this.registerInterval(this.obsidianPluginRefreshTimer);
  }

  private clearObsidianPluginRefreshTimer(): void {
    if (this.obsidianPluginRefreshTimer !== undefined) {
      window.clearTimeout(this.obsidianPluginRefreshTimer);
      this.obsidianPluginRefreshTimer = undefined;
    }
  }

  private async runDeferredObsidianPluginRefresh(): Promise<void> {
    const changedPaths = [...this.pendingObsidianPluginRefreshPaths];
    this.pendingObsidianPluginRefreshPaths.clear();
    this.obsidianPluginRefreshTimer = undefined;
    if (changedPaths.length === 0) {
      return;
    }

    const shouldRetry = await this.applyDeferredObsidianPluginRefresh(changedPaths);
    if (!shouldRetry) {
      this.obsidianPluginRefreshAttempts = 0;
      return;
    }

    if (this.obsidianPluginRefreshAttempts >= OBSIDIAN_PLUGIN_REFRESH_MAX_ATTEMPTS) {
      this.log("Synced community plugin refresh could not finish automatically. Reload the app or disable/enable the affected plugin once Obsidian has finished loading.");
      this.obsidianPluginRefreshAttempts = 0;
      return;
    }

    this.obsidianPluginRefreshAttempts++;
    for (const path of changedPaths) {
      this.pendingObsidianPluginRefreshPaths.add(path);
    }
    this.scheduleDeferredObsidianPluginRefresh(OBSIDIAN_PLUGIN_REFRESH_RETRY_MS);
  }

  private async applyDeferredObsidianPluginRefresh(changedPaths: string[]): Promise<boolean> {
    const plan = planObsidianConfigRefresh(changedPaths, this.app.vault.configDir, this.manifest.id);
    if (!shouldAutoApplyPluginRefresh(plan, Platform.isMobile)) {
      return false;
    }
    const pluginManager = (this.app as unknown as { plugins?: ObsidianPluginManager }).plugins;
    let shouldRetry = false;
    if (plan.communityPluginsChanged) {
      shouldRetry = await this.refreshCommunityPluginEnablement(pluginManager) || shouldRetry;
    }
    if (plan.pluginsToReload.length > 0) {
      shouldRetry = await this.reloadSyncedPlugins(pluginManager, plan.pluginsToReload) || shouldRetry;
    }
    return shouldRetry;
  }

  private async refreshCommunityPluginEnablement(pluginManager: ObsidianPluginManager | undefined): Promise<boolean> {
    const desired = await this.readCommunityPluginList();
    if (!desired || !pluginManager) {
      this.log("Synced community plugin list changed. Waiting for Obsidian's plugin manager before applying plugin enablement changes.");
      return !!desired;
    }

    await pluginManager.loadManifests?.();
    const enabled = this.enabledCommunityPlugins(pluginManager);
    const desiredToEnable = [...desired].filter((id) => id !== this.manifest.id && !enabled.has(id)).sort();
    const waitingForManifest = desiredToEnable.filter((id) => !this.pluginManifestAvailable(pluginManager, id));
    const toEnable = desiredToEnable.filter((id) => !waitingForManifest.includes(id));
    const toDisable = [...enabled].filter((id) => id !== this.manifest.id && !desired.has(id)).sort();

    if (waitingForManifest.length > 0) {
      this.log(`Synced community plugin list is waiting for Obsidian to discover: ${waitingForManifest.join(", ")}.`);
    }

    for (const id of toDisable) {
      if (typeof pluginManager.disablePlugin !== "function") {
        this.log(`Community plugin ${id} should be disabled by synced settings, but Obsidian did not expose a disable action.`);
        continue;
      }
      await pluginManager.disablePlugin(id);
      await this.yieldToUi();
    }

    for (const id of toEnable) {
      if (typeof pluginManager.enablePlugin !== "function") {
        this.log(`Community plugin ${id} should be enabled by synced settings, but Obsidian did not expose an enable action.`);
        continue;
      }
      await pluginManager.enablePlugin(id);
      await this.yieldToUi();
    }

    this.log(
      `Synced community plugin list refreshed. Enabled ${toEnable.length}, disabled ${toDisable.length}.`
    );
    return waitingForManifest.length > 0;
  }

  private async readCommunityPluginList(): Promise<Set<string> | undefined> {
    const adapter = this.app.vault.adapter as VaultListAdapter;
    if (typeof adapter.read !== "function") {
      return undefined;
    }
    try {
      const raw = await adapter.read(`${normalizePath(this.app.vault.configDir)}/community-plugins.json`);
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return undefined;
      }
      return new Set(parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0));
    } catch (error) {
      this.log(`Could not read synced community plugin list: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  private enabledCommunityPlugins(pluginManager: ObsidianPluginManager): Set<string> {
    if (pluginManager.enabledPlugins instanceof Set) {
      return new Set([...pluginManager.enabledPlugins].filter((id): id is string => typeof id === "string"));
    }
    if (Array.isArray(pluginManager.enabledPlugins)) {
      return new Set(pluginManager.enabledPlugins.filter((id): id is string => typeof id === "string"));
    }
    return new Set(Object.keys(pluginManager.plugins ?? {}));
  }

  private async reloadSyncedPlugins(pluginManager: ObsidianPluginManager | undefined, pluginIds: string[]): Promise<boolean> {
    if (!pluginManager) {
      this.log(`Synced plugin settings changed for ${pluginIds.join(", ")}. Waiting for Obsidian's plugin manager before reloading affected plugins.`);
      return true;
    }
    await pluginManager.loadManifests?.();
    const enabled = this.enabledCommunityPlugins(pluginManager);
    let reloaded = 0;
    let shouldRetry = false;
    for (const id of pluginIds) {
      if (!enabled.has(id)) {
        continue;
      }
      if (!this.pluginManifestAvailable(pluginManager, id)) {
        this.log(`Synced plugin ${id} changed, but Obsidian has not discovered its manifest yet. Waiting before reload.`);
        shouldRetry = true;
        continue;
      }
      try {
        await this.reloadOnePlugin(pluginManager, id);
        reloaded++;
        await this.yieldToUi();
      } catch (error) {
        this.log(`Could not reload synced plugin ${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (reloaded > 0) {
      this.log(`Reloaded ${reloaded} synced plugin${reloaded === 1 ? "" : "s"} after remote settings update.`);
    }
    return shouldRetry;
  }

  private async reloadOnePlugin(pluginManager: ObsidianPluginManager, id: string): Promise<void> {
    if (!this.pluginLoaded(pluginManager, id) && typeof pluginManager.enablePlugin === "function") {
      await pluginManager.enablePlugin(id);
      return;
    }
    if (typeof pluginManager.reloadPlugin === "function") {
      await pluginManager.reloadPlugin(id);
      return;
    }
    if (typeof pluginManager.unloadPlugin === "function" && typeof pluginManager.loadPlugin === "function") {
      await pluginManager.unloadPlugin(id);
      await pluginManager.loadPlugin(id);
      return;
    }
    if (typeof pluginManager.disablePlugin === "function" && typeof pluginManager.enablePlugin === "function") {
      await pluginManager.disablePlugin(id);
      await pluginManager.enablePlugin(id);
      return;
    }
    throw new Error("No compatible Obsidian plugin reload action was available.");
  }

  private pluginManifestAvailable(pluginManager: ObsidianPluginManager, id: string): boolean {
    const manifests = pluginManager.manifests;
    if (!manifests) {
      return true;
    }
    return hasRecordKey(manifests, id);
  }

  private pluginLoaded(pluginManager: ObsidianPluginManager, id: string): boolean {
    return hasRecordKey(pluginManager.plugins ?? {}, id);
  }

  private applyBatchLimit(): number {
    return Math.max(1, Math.round(this.settings.maxStorageApplyConcurrency || DEFAULT_SETTINGS.maxStorageApplyConcurrency));
  }

  private async withSuppressedVaultEvents<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.suppressVaultEventQueue;
    this.suppressVaultEventQueue = true;
    try {
      return await operation();
    } finally {
      this.suppressVaultEventQueue = previous;
    }
  }

  private registerProtocolHandler(): void {
    this.registerObsidianProtocolHandler("setuplivesync", async (params) => {
      if (typeof params.settings === "string" && params.settings) {
        await this.promptForSetupUri(`obsidian://setuplivesync?settings=${encodeURIComponent(params.settings)}`);
        return;
      }

      if (typeof params.settingsQR === "string" && params.settingsQR) {
        await this.importSetupQr(params.settingsQR);
      }
    });
  }

  private registerVaultEvents(): void {
    this.registerEvent(this.app.vault.on("create", (file) => {
      this.queueVaultFile(file);
    }));
    this.registerEvent(this.app.vault.on("modify", (file) => this.queueVaultFile(file)));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      this.queueVaultFile(file, true);
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      this.queueVaultPath(oldPath, true);
      this.queueVaultFile(file);
    }));
  }

  private registerNetworkEvents(): void {
    const handleOnline = () => {
      this.setStatus("Network online");
      if (this.canRunAutomaticSync()) {
        this.scheduler.request("periodic", true);
      }
    };
    const handleOffline = () => {
      this.setStatus("Network offline. Sync paused.");
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    this.register(() => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    });
  }

  private registerForegroundRemoteChecks(): void {
    const requestForegroundCheck = () => {
      if (activeDocument.hidden) {
        return;
      }
      if (!this.canRunAutomaticSync()) {
        return;
      }
      const now = Date.now();
      const throttleMs = this.minimumIntervalMsForSyncReason("periodic");
      if (now - this.lastForegroundRemoteCheckAt < throttleMs) {
        return;
      }
      this.lastForegroundRemoteCheckAt = now;
      this.logProgress("App became active; checking CouchDB for remote changes.", true);
      this.scheduler.request("periodic", true);
      void this.queueRecentlyChangedConfigForSync("Foreground config scan", {
        minIntervalMs: FOREGROUND_MOBILE_REMOTE_CHECK_INTERVAL_SEC * 1000
      }).then((summary) => {
        if ((summary?.pendingPush ?? 0) > 0) {
          this.scheduler.request("vault-change", true);
        }
      }).catch((error) => {
        this.log(`Foreground config scan skipped: ${error instanceof Error ? error.message : String(error)}`);
      });
    };
    const handleVisibilityChange = () => {
      this.reschedulePeriodicSync();
      if (!activeDocument.hidden) {
        requestForegroundCheck();
      }
    };
    window.addEventListener("focus", requestForegroundCheck);
    activeDocument.addEventListener("visibilitychange", handleVisibilityChange);
    this.register(() => {
      window.removeEventListener("focus", requestForegroundCheck);
      activeDocument.removeEventListener("visibilitychange", handleVisibilityChange);
    });
  }

  private queueVaultFile(file: unknown, deleted = false): void {
    if (file instanceof TFile) {
      this.queueVaultPath(file.path, deleted);
    }
  }

  private queueVaultPath(path: string, deleted = false): void {
    if (!this.shouldQueueVaultPath(path)) {
      return;
    }
    const startingNewBatch = this.vaultChangeBatchTimer === undefined;
    void this.queueLocalPush(path, deleted);
    if (startingNewBatch) {
      this.logProgress(`Local ${deleted ? "delete" : "edit"} noticed for ${path}. Upload will start after the batching window.`, true);
    }
    this.scheduleVaultChangeBatchSync(this.isConfigSyncPath(path) ? FAST_CONFIG_SYNC_DELAY_MS : undefined);
  }

  private shouldQueueVaultPath(path: string): boolean {
    return (
      !this.suppressVaultEventQueue &&
      this.settings.configured &&
      this.settings.syncOnSave &&
      this.shouldSyncPath(path)
    );
  }

  private isConfigSyncPath(path: string): boolean {
    const cleaned = normalizePath(path);
    const configDir = normalizePath(this.app.vault.configDir);
    return cleaned === configDir || cleaned.startsWith(`${configDir}/`);
  }

  private reschedulePeriodicSync(): void {
    this.clearPeriodicTimer();
    if (!this.settings.periodicSync || this.settings.periodicSyncIntervalSec <= 0 || !this.canRunAutomaticSync()) {
      return;
    }
    const intervalSec = this.effectiveRemoteCheckIntervalSec();
    this.periodicTimer = window.setInterval(() => {
      if (this.canRunAutomaticSync()) {
        void this.queueRecentlyChangedConfigForSync("Periodic config scan", {
          minIntervalMs: CONFIG_FALLBACK_SCAN_INTERVAL_MS
        }).finally(() => {
          this.scheduler.request("periodic");
        });
      }
    }, intervalSec * 1000);
    this.registerInterval(this.periodicTimer);
  }

  private effectiveRemoteCheckIntervalSec(): number {
    const normalInterval = Math.min(
      DEFAULT_REMOTE_CHECK_INTERVAL_SEC,
      Math.max(FOREGROUND_MOBILE_REMOTE_CHECK_INTERVAL_SEC, Math.round(this.settings.periodicSyncIntervalSec || DEFAULT_REMOTE_CHECK_INTERVAL_SEC))
    );
    return this.isMobileForeground() ? FOREGROUND_MOBILE_REMOTE_CHECK_INTERVAL_SEC : normalInterval;
  }

  private isMobileForeground(): boolean {
    return Platform.isMobile && !activeDocument.hidden;
  }

  private minimumIntervalMsForSyncReason(reason: string): number {
    if (reason === "periodic") {
      return this.effectiveRemoteCheckIntervalSec() * 1000;
    }
    if (reason === "startup" || reason === "setup-import" || reason === "setup-qr-import" || reason === "manual") {
      return 0;
    }
    return Math.max(0, this.settings.minimumSyncIntervalMs);
  }

  private isNetworkLikelyOnline(): boolean {
    return activeWindow.navigator.onLine !== false;
  }

  private yieldToUi(): Promise<void> {
    return new Promise((resolve) => {
      if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => resolve());
        return;
      }
      window.setTimeout(resolve, 0);
    });
  }

  private clearPeriodicTimer(): void {
    if (this.periodicTimer !== undefined) {
      window.clearInterval(this.periodicTimer);
      this.periodicTimer = undefined;
    }
  }

  private scheduleVaultChangeBatchSync(delayOverrideMs?: number): void {
    if (!this.canRunAutomaticSync()) {
      this.setStatus("Changes queued. Update saved credentials to sync.");
      return;
    }

    const delayMs = delayOverrideMs ?? Math.max(0, this.settings.vaultChangeBatchWindowSec) * 1000;
    const dueAt = Date.now() + delayMs;
    if (this.vaultChangeBatchTimer !== undefined) {
      if (dueAt >= this.vaultChangeBatchDueAt) {
        const remainingMs = Math.max(0, this.vaultChangeBatchDueAt - Date.now());
        this.setStatus(remainingMs > 0 ? `Batching vault changes for ${Math.ceil(remainingMs / 1000)}s` : "Sync queued: vault-change");
        return;
      }
      window.clearTimeout(this.vaultChangeBatchTimer);
      this.vaultChangeBatchTimer = undefined;
    }

    this.vaultChangeBatchDueAt = dueAt;
    this.vaultChangeBatchTimer = window.setTimeout(() => {
      this.vaultChangeBatchTimer = undefined;
      this.vaultChangeBatchDueAt = 0;
      this.scheduler.request("vault-change", true);
    }, delayMs);
    this.registerInterval(this.vaultChangeBatchTimer);
    this.setStatus(delayMs > 0 ? `Batching vault changes for ${Math.ceil(delayMs / 1000)}s` : "Sync queued: vault-change");
  }

  private clearVaultChangeBatchTimer(): void {
    if (this.vaultChangeBatchTimer !== undefined) {
      window.clearTimeout(this.vaultChangeBatchTimer);
      this.vaultChangeBatchTimer = undefined;
    }
    this.vaultChangeBatchDueAt = 0;
  }

  private requestConfigScanAfterSync(label: string, options: { force?: boolean; minIntervalMs?: number } = {}): void {
    void this.queueRecentlyChangedConfigForSync(label, options)
      .then((summary) => {
        if ((summary?.pendingPush ?? 0) > 0) {
          this.scheduler.request("vault-change", true);
        }
      })
      .catch((error) => {
        this.log(`${label} skipped: ${error instanceof Error ? error.message : String(error)}`);
      });
  }

  private async updateRemoteInspection(inspection: RemoteInspection): Promise<void> {
    const current = this.settings.remoteState;
    const unchanged =
      current.databaseName === inspection.databaseName &&
      current.documentCount === inspection.documentCount &&
      current.updateSequence === inspection.updateSequence &&
      current.syncParametersPresent === inspection.syncParametersPresent &&
      current.milestonePresent === inspection.milestonePresent &&
      (!inspection.recentChangesSampled || current.sampledNotes === inspection.sample.notes) &&
      (!inspection.recentChangesSampled || current.sampledChunks === inspection.sample.chunks) &&
      (!inspection.recentChangesSampled || current.sampledDeleted === inspection.sample.deleted) &&
      (!inspection.recentChangesSampled || current.sampledUnknown === inspection.sample.unknown) &&
      current.syncParameterSalt === inspection.syncParameterSalt;
    if (unchanged) {
      return;
    }
    const remoteState: RemoteInspectionState = {
      lastCheckedAt: Date.now(),
      databaseName: inspection.databaseName,
      documentCount: inspection.documentCount,
      updateSequence: inspection.updateSequence,
      syncParametersPresent: inspection.syncParametersPresent,
      milestonePresent: inspection.milestonePresent,
      sampledNotes: inspection.recentChangesSampled ? inspection.sample.notes : current.sampledNotes,
      sampledChunks: inspection.recentChangesSampled ? inspection.sample.chunks : current.sampledChunks,
      sampledDeleted: inspection.recentChangesSampled ? inspection.sample.deleted : current.sampledDeleted,
      sampledUnknown: inspection.recentChangesSampled ? inspection.sample.unknown : current.sampledUnknown,
      syncParameterSalt: inspection.syncParameterSalt
    };
    this.settings = {
      ...this.settings,
      remoteState
    };
    await this.saveSettingsAndReschedule();
  }

  private async baselineRemoteCheckpoint(inspection: RemoteInspection): Promise<void> {
    if (!inspection.updateSequence || !this.settings.couchDb.database) {
      return;
    }
    const store = this.getLocalStore(this.settings.couchDb.database);
    await store.setCheckpoint(inspection.updateSequence);
    await this.updateLocalQueue(await store.getSummary());
  }

  private canRunAutomaticSync(): boolean {
    const settings = this.getRuntimeSettings();
    if (!settings.configured || !hasUsableRemote(settings) || credentialsAreLocked(settings)) {
      return false;
    }
    return !settings.requireE2EE || (settings.encrypt && !!settings.passphrase);
  }

  private async updateLocalQueue(summary: LocalStoreSummary): Promise<void> {
    const current = this.settings.localQueue;
    const unchanged =
      current.lastRemoteSeq === summary.lastRemoteSeq &&
      current.files === summary.files &&
      current.chunks === summary.chunks &&
      current.deleted === summary.deleted &&
      current.pendingApply === summary.pendingApply &&
      current.pendingPush === summary.pendingPush;
    if (unchanged) {
      return;
    }
    const localQueue: LocalQueueState = {
      lastPulledAt: Date.now(),
      lastRemoteSeq: summary.lastRemoteSeq,
      files: summary.files,
      chunks: summary.chunks,
      deleted: summary.deleted,
      pendingApply: summary.pendingApply,
      pendingPush: summary.pendingPush
    };
    this.settings = {
      ...this.settings,
      localQueue
    };
    this.scheduleRuntimeDiagnosticsSave();
  }

  private async getLocalVaultStats(): Promise<LocalVaultStats> {
    let fileCount = 0;
    let totalBytes = 0;
    for (const file of this.app.vault.getFiles()) {
      const path = normalizePath(file.path);
      if (!this.shouldSyncPath(path)) {
        continue;
      }
      fileCount++;
      totalBytes += Math.max(0, file.stat.size);
    }
    return { fileCount, totalBytes };
  }

  private updateLocalWorkState(work: LocalSyncWorkState): void {
    const current = this.settings.localQueue;
    if (
      current.lastRemoteSeq === work.lastRemoteSeq &&
      current.pendingApply === work.pendingApply &&
      current.pendingPush === work.pendingPush
    ) {
      return;
    }
    this.settings = {
      ...this.settings,
      localQueue: {
        ...current,
        lastPulledAt: Date.now(),
        lastRemoteSeq: work.lastRemoteSeq,
        pendingApply: work.pendingApply,
        pendingPush: work.pendingPush
      }
    };
    this.scheduleRuntimeDiagnosticsSave();
  }

  private async updateLocalPreview(summary: ReconstructionBatchSummary): Promise<void> {
    const localPreview: LocalPreviewState = {
      lastPreviewedAt: Date.now(),
      checked: summary.checked,
      ready: summary.ready,
      deleted: summary.deleted,
      missingChunks: summary.missingChunks,
      encryptedUnsupported: summary.encryptedUnsupported,
      unsupported: summary.unsupported
    };
    this.settings = {
      ...this.settings,
      localPreview
    };
    this.scheduleRuntimeDiagnosticsSave();
  }

  private async updateLocalStaging(result: StagingApplyResult): Promise<void> {
    const localStaging: LocalStagingState = {
      lastStagedAt: Date.now(),
      staged: result.staged,
      skipped: result.skipped,
      failed: result.failed,
      folder: result.basePath
    };
    this.settings = {
      ...this.settings,
      localStaging
    };
    this.scheduleRuntimeDiagnosticsSave();
  }

  private async updateLocalLiveApply(result: LiveVaultApplyResult): Promise<void> {
    const localLiveApply: LocalLiveApplyState = {
      lastAppliedAt: Date.now(),
      applied: result.applied,
      deleted: result.deleted,
      skipped: result.skipped,
      waiting: result.waiting,
      merged: result.merged,
      backedUp: result.backedUp,
      conflicted: result.conflicted,
      failed: result.failed,
      conflictFolder: result.conflictFolder
    };
    this.settings = {
      ...this.settings,
      localLiveApply
    };
    this.scheduleRuntimeDiagnosticsSave();
  }

  private recordSyncStart(reason: string, startedAt: number): void {
    this.lastProgressLogAt = 0;
    this.clearCompletedStatusTimer();
    this.statusUploadRate = "0";
    this.statusDownloadRate = "0";
    const runtime: RuntimeDiagnosticsState = {
      ...this.settings.runtime,
      lastSyncReason: reason,
      lastSyncStartedAt: startedAt,
      lastSyncFinishedAt: 0,
      lastSyncDurationMs: 0,
      lastSyncOk: false,
      lastSyncMessage: "Sync in progress.",
      lastSyncError: "",
      syncsStarted: this.settings.runtime.syncsStarted + 1,
      lastSyncMetrics: { ...DEFAULT_SETTINGS.runtime.lastSyncMetrics }
    };
    this.settings = {
      ...this.settings,
      runtime
    };
    this.setStatus("Syncing");
    this.log(`${friendlySyncReason(reason)} sync started.`);
    this.scheduleRuntimeDiagnosticsSave(250);
  }

  private async markInterruptedSyncIfNeeded(): Promise<void> {
    const runtime = this.settings.runtime;
    if (runtime.lastSyncStartedAt === 0 || runtime.lastSyncFinishedAt !== 0) {
      return;
    }

    const finishedAt = Date.now();
    this.settings = {
      ...this.settings,
      runtime: {
        ...runtime,
        lastSyncFinishedAt: finishedAt,
        lastSyncDurationMs: Math.max(0, finishedAt - runtime.lastSyncStartedAt),
        lastSyncOk: false,
        lastSyncMessage: "Previous sync was interrupted before it could finish.",
        lastSyncError: "Previous sync was interrupted before it could finish.",
        syncsFinished: runtime.syncsFinished + 1,
        syncsFailed: runtime.syncsFailed + 1
      }
    };
    this.log("Previous sync was interrupted before it could finish.");
    await this.saveRuntimeDiagnostics();
  }

  private recordSyncFinish(details: {
    reason: string;
    startedAt: number;
    finishedAt: number;
    result?: SyncOutcome;
    errorMessage?: string;
  }): void {
    const failed = !!details.errorMessage || details.result?.ok === false;
    const runtime: RuntimeDiagnosticsState = {
      ...this.settings.runtime,
      lastSyncReason: details.reason,
      lastSyncStartedAt: details.startedAt,
      lastSyncFinishedAt: details.finishedAt,
      lastSyncDurationMs: Math.max(0, details.finishedAt - details.startedAt),
      lastSyncOk: !failed,
      lastSyncMessage: details.result?.message ?? "",
      lastSyncError: details.errorMessage ?? (details.result?.ok === false ? details.result.message : ""),
      syncsFinished: this.settings.runtime.syncsFinished + 1,
      syncsFailed: this.settings.runtime.syncsFailed + (failed ? 1 : 0),
      lastSyncMetrics: {
        ...DEFAULT_SETTINGS.runtime.lastSyncMetrics,
        ...details.result?.metrics
      }
    };
    this.settings = {
      ...this.settings,
      runtime
    };
    if (details.reason === "startup" && !failed) {
      this.requestConfigScanAfterSync("Startup config scan", { force: true });
    }
    if (failed) {
      this.log(`${friendlySyncReason(details.reason)} sync stopped with an issue: ${runtime.lastSyncError || runtime.lastSyncMessage}`);
    } else if (details.result?.ok && details.result.continueSync) {
      this.setStatus("Syncing");
      this.log(`${friendlySyncReason(details.reason)} sync pass finished. ${runtime.lastSyncMessage || "More sync work remains."}`);
    } else {
      this.showCompletedStatus();
      this.log(`${friendlySyncReason(details.reason)} sync finished. ${runtime.lastSyncMessage || "No remaining work reported."}`);
    }
    void this.saveRuntimeDiagnostics();
  }

  private async saveRuntimeDiagnostics(): Promise<void> {
    this.clearRuntimeDiagnosticsSaveTimer();
    await this.saveData(settingsForDisk(this.settings));
  }

  private scheduleRuntimeDiagnosticsSave(delayMs = 1500): void {
    if (this.runtimeDiagnosticsSaveTimer !== undefined) {
      return;
    }
    this.runtimeDiagnosticsSaveTimer = window.setTimeout(() => {
      this.runtimeDiagnosticsSaveTimer = undefined;
      void this.saveRuntimeDiagnostics();
    }, delayMs);
  }

  private clearRuntimeDiagnosticsSaveTimer(): void {
    if (this.runtimeDiagnosticsSaveTimer !== undefined) {
      window.clearTimeout(this.runtimeDiagnosticsSaveTimer);
      this.runtimeDiagnosticsSaveTimer = undefined;
    }
  }

  private getLocalStore(databaseName: string): LocalDocumentStore {
    const key = databaseName || "default";
    const existing = this.localStores.get(key);
    if (existing) {
      return existing;
    }
    const created = new LocalDocumentStore(key);
    this.localStores.set(key, created);
    return created;
  }

  private async queueLocalPush(path: string, deleted: boolean): Promise<void> {
    if (!this.settings.couchDb.database) {
      return;
    }
    this.forgetLocalSnapshot(path);
    const store = this.getLocalStore(this.settings.couchDb.database);
    await store.queueLocalChangeOnly(path, deleted);
    this.updateLocalWorkState(await store.getWorkState());
  }

  private async queueCurrentVaultForSync(label: string): Promise<LocalStoreSummary | undefined> {
    if (!this.settings.configured || !this.settings.couchDb.database) {
      return undefined;
    }

    const paths = await this.listCurrentVaultPathsForSync();
    if (paths.length === 0) {
      return undefined;
    }

    this.setStatus("Scanning vault");
    const store = this.getLocalStore(this.settings.couchDb.database);
    const changedPaths = await this.filterPathsNeedingLocalPush(paths, store);
    if (changedPaths.length === 0) {
      const summary = await store.getSummary();
      await this.updateLocalQueue(summary);
      this.log(`${label} checked ${paths.length} vault file${paths.length === 1 ? "" : "s"} locally; no changed files needed upload.`);
      await this.yieldToUi();
      return summary;
    }

    const changes = changedPaths.map((path) => ({
      path,
      deleted: false
    }));
    const summary = await store.queueLocalChanges(changes);
    await this.updateLocalQueue(summary);
    const skipped = paths.length - changedPaths.length;
    this.log(`${label} queued ${changes.length} changed vault file${changes.length === 1 ? "" : "s"} for upload; ${skipped} unchanged file${skipped === 1 ? "" : "s"} skipped locally.`);
    await this.yieldToUi();
    return summary;
  }

  private async filterPathsNeedingLocalPush(paths: string[], store: LocalDocumentStore): Promise<string[]> {
    const changed: string[] = [];
    const fingerprints = await store.getLocalPushFingerprints(paths);
    for (const [index, path] of paths.entries()) {
      const info = await this.readLocalFileInfo(path);
      const fingerprint = fingerprints.get(path) ?? "";
      if (!localPushFingerprintMatchesFileInfo(fingerprint, info)) {
        changed.push(path);
      }
      if (index > 0 && index % 50 === 0) {
        await this.yieldToUi();
      }
    }
    return changed;
  }

  private async shouldManualSyncPullBeforeFullVaultScan(): Promise<boolean> {
    if (
      !this.settings.configured ||
      !this.settings.couchDb.database ||
      this.getRuntimeSettings().deviceSetupRole !== "additional-device"
    ) {
      return false;
    }
    const summary = await this.getLocalStore(this.settings.couchDb.database).getSummary();
    return summary.lastRemoteSeq === "0";
  }

  private async listCurrentVaultPathsForSync(): Promise<string[]> {
    const paths = new Set<string>();
    for (const file of this.app.vault.getFiles()) {
      const path = normalizePath(file.path);
      if (this.shouldSyncPath(path)) {
        paths.add(path);
      }
    }

    const adapter = this.app.vault.adapter as VaultListAdapter;
    if (typeof adapter.list === "function") {
      await this.collectAdapterPathsForSync(adapter, "", paths);
    }

    return [...paths].sort();
  }

  private async collectAdapterPathsForSync(
    adapter: VaultListAdapter,
    folder: string,
    paths: Set<string>
  ): Promise<void> {
    const listed = await adapter.list?.(folder);
    if (!listed) {
      return;
    }

    for (const file of listed.files) {
      const path = normalizePath(file);
      if (this.shouldSyncPath(path)) {
        paths.add(path);
      }
    }

    for (const childFolder of listed.folders) {
      const path = normalizePath(childFolder);
      if (shouldScanVaultFolder(path, this.syncPathOptions())) {
        await this.yieldToUi();
        await this.collectAdapterPathsForSync(adapter, path, paths);
      }
    }
  }

  private async queueRecentlyChangedConfigForSync(
    label: string,
    options: { force?: boolean; minIntervalMs?: number } = {}
  ): Promise<LocalStoreSummary | undefined> {
    if (!this.settings.configured || !this.settings.couchDb.database || !this.settings.syncOnSave) {
      return undefined;
    }
    const since = this.settings.runtime.lastSyncFinishedAt;
    if (since <= 0) {
      return undefined;
    }
    const now = Date.now();
    const minIntervalMs = Math.max(0, options.minIntervalMs ?? 0);
    if (!options.force && minIntervalMs > 0 && now - this.lastConfigFallbackScanAt < minIntervalMs) {
      return undefined;
    }
    if (this.configFallbackScanPromise) {
      return this.configFallbackScanPromise;
    }
    this.configFallbackScanPromise = this.runRecentlyChangedConfigForSync(label, since, now);
    try {
      return await this.configFallbackScanPromise;
    } finally {
      this.configFallbackScanPromise = undefined;
    }
  }

  private async runRecentlyChangedConfigForSync(label: string, since: number, startedAt: number): Promise<LocalStoreSummary | undefined> {
    this.lastConfigFallbackScanAt = startedAt;
    const adapter = this.app.vault.adapter as VaultListAdapter;
    if (typeof adapter.list !== "function") {
      return undefined;
    }

    const paths = new Set<string>();
    await this.collectRecentlyChangedConfigPaths(adapter, normalizePath(this.app.vault.configDir), since, paths);
    if (paths.size === 0) {
      return undefined;
    }

    const store = this.getLocalStore(this.settings.couchDb.database);
    const sortedPaths = [...paths].sort();
    const changedPaths = await this.filterPathsNeedingLocalPush(sortedPaths, store);
    if (changedPaths.length === 0) {
      const summary = await store.getSummary();
      await this.updateLocalQueue(summary);
      this.log(`${label} checked ${sortedPaths.length} recently changed configuration/plugin file${sortedPaths.length === 1 ? "" : "s"}; all were already synced.`);
      return summary;
    }

    const changes = changedPaths.map((path) => ({
      path,
      deleted: false
    }));
    const summary = await store.queueLocalChanges(changes);
    await this.updateLocalQueue(summary);
    const skipped = sortedPaths.length - changedPaths.length;
    this.log(`${label} queued ${changes.length} recently changed configuration/plugin file${changes.length === 1 ? "" : "s"} for upload; ${skipped} unchanged file${skipped === 1 ? "" : "s"} skipped locally.`);
    return summary;
  }

  private async collectRecentlyChangedConfigPaths(
    adapter: VaultListAdapter,
    folder: string,
    since: number,
    paths: Set<string>
  ): Promise<void> {
    if (!shouldScanVaultFolder(folder, this.syncPathOptions())) {
      return;
    }
    const listed = await adapter.list?.(folder);
    if (!listed) {
      return;
    }

    for (const file of listed.files) {
      const path = normalizePath(file);
      if (!this.isConfigSyncPath(path) || !this.shouldSyncPath(path)) {
        continue;
      }
      const stat = await adapter.stat?.(path);
      if ((stat?.mtime ?? 0) > since) {
        paths.add(path);
      }
    }

    for (const childFolder of listed.folders) {
      const path = normalizePath(childFolder);
      if (this.isConfigSyncPath(path) && shouldScanVaultFolder(path, this.syncPathOptions())) {
        await this.yieldToUi();
        await this.collectRecentlyChangedConfigPaths(adapter, path, since, paths);
      }
    }
  }

  private async readLocalFileInfo(path: string): Promise<LocalFileInfo | undefined> {
    const normalizedPath = normalizePath(path);
    if (!this.shouldSyncPath(normalizedPath)) {
      return undefined;
    }

    const file = this.app.vault.getAbstractFileByPath(normalizedPath);
    if (file instanceof TFile) {
      return {
        path: file.path,
        ctime: file.stat.ctime,
        mtime: file.stat.mtime,
        size: file.stat.size,
        contentType: this.shouldReadFileAsText(file) ? "text" : "binary"
      };
    }

    const adapter = this.app.vault.adapter as VaultListAdapter;
    if (typeof adapter.exists === "function" && !(await adapter.exists(normalizedPath))) {
      return undefined;
    }
    const stat = await adapter.stat?.(normalizedPath);
    if (!stat) {
      return undefined;
    }
    return {
      path: normalizedPath,
      ctime: stat.ctime,
      mtime: stat.mtime,
      size: stat.size,
      contentType: this.shouldReadPathAsText(normalizedPath) ? "text" : "binary"
    };
  }

  private async readLocalFileSnapshot(path: string) {
    const normalizedPath = normalizePath(path);
    if (!this.shouldSyncPath(normalizedPath)) {
      return undefined;
    }

    const info = await this.readLocalFileInfo(normalizedPath);
    const cached = info ? this.getCachedLocalSnapshot(info) : undefined;
    if (cached) {
      return cached;
    }

    const file = this.app.vault.getAbstractFileByPath(normalizedPath);
    if (file instanceof TFile) {
      const content = this.shouldReadFileAsText(file)
        ? await this.app.vault.read(file)
        : await this.app.vault.readBinary(file);
      const snapshot = {
        path: file.path,
        content,
        ctime: file.stat.ctime,
        mtime: file.stat.mtime,
        size: file.stat.size
      };
      this.rememberLocalSnapshot(snapshot);
      return snapshot;
    }

    const adapter = this.app.vault.adapter as VaultListAdapter;
    if (typeof adapter.exists === "function" && !(await adapter.exists(normalizedPath))) {
      return undefined;
    }
    if (typeof adapter.read !== "function" || typeof adapter.readBinary !== "function") {
      return undefined;
    }

    const stat = await adapter.stat?.(normalizedPath);
    const content = this.shouldReadPathAsText(normalizedPath)
      ? await adapter.read(normalizedPath)
      : await adapter.readBinary(normalizedPath);
    const fallbackTime = Date.now();
    const snapshot = {
      path: normalizedPath,
      content,
      ctime: stat?.ctime ?? stat?.mtime ?? fallbackTime,
      mtime: stat?.mtime ?? stat?.ctime ?? fallbackTime,
      size: stat?.size ?? (typeof content === "string" ? new TextEncoder().encode(content).byteLength : content.byteLength)
    };
    this.rememberLocalSnapshot(snapshot);
    return snapshot;
  }

  private localSnapshotCacheKey(info: Pick<LocalFileInfo, "contentType" | "size" | "mtime">): string {
    return `${info.contentType}:${info.size}:${Math.trunc(info.mtime)}`;
  }

  private getCachedLocalSnapshot(info: LocalFileInfo): LocalFileSnapshot | undefined {
    const normalizedPath = normalizePath(info.path);
    const entry = this.localSnapshotCache.get(normalizedPath);
    if (!entry || entry.cacheKey !== this.localSnapshotCacheKey(info)) {
      return undefined;
    }
    entry.usedAt = Date.now();
    return entry.snapshot;
  }

  private rememberLocalSnapshot(snapshot: LocalFileSnapshot): void {
    const bytes = Math.max(0, snapshot.size);
    if (bytes > SNAPSHOT_CACHE_MAX_FILE_BYTES) {
      this.forgetLocalSnapshot(snapshot.path);
      return;
    }

    const normalizedPath = normalizePath(snapshot.path);
    const contentType = typeof snapshot.content === "string" ? "text" : "binary";
    const cacheKey = this.localSnapshotCacheKey({
      contentType,
      size: snapshot.size,
      mtime: snapshot.mtime
    });
    const existing = this.localSnapshotCache.get(normalizedPath);
    if (existing) {
      this.localSnapshotCacheBytes -= existing.bytes;
    }
    this.localSnapshotCache.set(normalizedPath, {
      snapshot,
      cacheKey,
      bytes,
      usedAt: Date.now()
    });
    this.localSnapshotCacheBytes += bytes;
    this.trimLocalSnapshotCache();
  }

  private trimLocalSnapshotCache(): void {
    while (
      this.localSnapshotCache.size > SNAPSHOT_CACHE_MAX_ENTRIES ||
      this.localSnapshotCacheBytes > SNAPSHOT_CACHE_MAX_BYTES
    ) {
      const oldest = [...this.localSnapshotCache.entries()]
        .sort((left, right) => left[1].usedAt - right[1].usedAt)[0];
      if (!oldest) {
        return;
      }
      this.localSnapshotCache.delete(oldest[0]);
      this.localSnapshotCacheBytes -= oldest[1].bytes;
    }
  }

  private forgetLocalSnapshot(path: string): void {
    const normalizedPath = normalizePath(path);
    const existing = this.localSnapshotCache.get(normalizedPath);
    if (!existing) {
      return;
    }
    this.localSnapshotCache.delete(normalizedPath);
    this.localSnapshotCacheBytes -= existing.bytes;
  }

  private clearLocalSnapshotCache(): void {
    this.localSnapshotCache.clear();
    this.localSnapshotCacheBytes = 0;
  }

  private shouldReadFileAsText(file: TFile): boolean {
    return this.shouldReadPathAsText(file.path);
  }

  private shouldReadPathAsText(path: string): boolean {
    return isTextSyncPath(path);
  }

  private shouldSyncPath(path: string): boolean {
    return shouldSyncVaultPath(path, this.syncPathOptions());
  }

  private syncPathOptions(): VaultSyncPathOptions {
    return {
      configDir: this.app.vault.configDir,
      pluginId: this.manifest.id,
      previewExportFolder: this.previewExportFolder(),
      stagingApplyFolder: this.stagingApplyFolder(),
      conflictFolder: this.conflictFolder()
    };
  }

  private async buildLocalPushBundle(snapshot: LocalFileSnapshot, options: LiveSyncBuildOptions) {
    if (!this.workerClient) {
      throw new Error("Background worker client is not initialised.");
    }
    return this.workerClient.buildPushBundle(snapshot, options);
  }

  private workerScriptUrl(): string | undefined {
    const adapter = this.app.vault.adapter as { getResourcePath?: (path: string) => string };
    if (typeof adapter.getResourcePath !== "function") {
      return undefined;
    }
    return adapter.getResourcePath(`${this.pluginInstallDir()}/sync-worker.js`);
  }

  private workerSourceAvailable(): boolean {
    return !!this.workerScriptUrl() || EMBEDDED_SYNC_WORKER_SOURCE.length > 0;
  }

  private async workerScriptSource(): Promise<string | undefined> {
    if (this.workerScriptSourceCache) {
      return this.workerScriptSourceCache;
    }
    const adapter = this.app.vault.adapter as VaultListAdapter;
    if (typeof adapter.read !== "function") {
      return EMBEDDED_SYNC_WORKER_SOURCE || undefined;
    }
    try {
      this.workerScriptSourceCache = await adapter.read(`${this.pluginInstallDir()}/sync-worker.js`);
      return this.workerScriptSourceCache;
    } catch (error) {
      if (EMBEDDED_SYNC_WORKER_SOURCE) {
        this.workerScriptSourceCache = EMBEDDED_SYNC_WORKER_SOURCE;
        this.log("Background worker file was not found; using the built-in worker source instead.");
        return this.workerScriptSourceCache;
      }
      this.log(`Background worker source could not be read from the plugin folder. ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  private pluginInstallDir(): string {
    const manifest = this.manifest as { dir?: string; id: string };
    return manifest.dir ?? `${this.app.vault.configDir}/plugins/${manifest.id}`;
  }

  private previewExportFolder(): string {
    if (this.settings.previewExportFolder) {
      return this.settings.previewExportFolder.replace(/^\/+|\/+$/g, "");
    }
    return `${this.app.vault.configDir}/plugins/${this.manifest.id}/preview`;
  }

  private stagingApplyFolder(): string {
    if (this.settings.stagingApplyFolder) {
      return this.settings.stagingApplyFolder.replace(/^\/+|\/+$/g, "");
    }
    return `${this.app.vault.configDir}/plugins/${this.manifest.id}/staging`;
  }

  private conflictFolder(): string {
    if (this.settings.conflictFolder) {
      return this.settings.conflictFolder.replace(/^\/+|\/+$/g, "");
    }
    return `${this.app.vault.configDir}/plugins/${this.manifest.id}/conflicts`;
  }

  private documentTransformOptions() {
    const settings = this.getRuntimeSettings();
    return {
      passphrase: settings.passphrase,
      syncParameterSalt: settings.remoteState.syncParameterSalt,
      useDynamicIterationCount: settings.useDynamicIterationCount,
      e2eeAlgorithm: settings.e2eeAlgorithm
    };
  }

  private setStatus(message: string): void {
    this.statusPresenter?.set(message);
  }

  private showCompletedStatus(): void {
    this.clearCompletedStatusTimer();
    this.statusUploadRate = "0";
    this.statusDownloadRate = "0";
    this.setStatus("Completed");
    this.completedStatusTimer = window.setTimeout(() => {
      this.completedStatusTimer = undefined;
      this.statusUploadRate = "0";
      this.statusDownloadRate = "0";
      this.setStatus("Ready");
    }, 3000);
  }

  private clearCompletedStatusTimer(): void {
    if (this.completedStatusTimer !== undefined) {
      window.clearTimeout(this.completedStatusTimer);
      this.completedStatusTimer = undefined;
    }
  }

  private reportSyncProgress(progress: SyncProgress): void {
    switch (progress.phase) {
      case "inspect-start":
        this.statusUploadRate = "0";
        this.statusDownloadRate = "0";
        this.setStatus("Checking server");
        this.logProgress("Checking the CouchDB server before syncing.", true);
        return;
      case "inspect-complete":
        this.setStatus("Server checked");
        this.logProgress(`CouchDB is reachable. The remote database currently has ${progress.documentCount} document${progress.documentCount === 1 ? "" : "s"}.`, true);
        return;
      case "push-start":
        this.statusUploadRate = "0";
        this.statusDownloadRate = "0";
        this.setStatus(`Upload 0/${progress.total}`);
        this.logProgress(`Starting upload check for ${progress.total} queued file${progress.total === 1 ? "" : "s"}. Unchanged files will be skipped.`, true);
        return;
      case "push-file-start":
        this.setStatus(`Upload ${progress.completed}/${progress.total}`);
        if (progress.completed === 0 || progress.completed % 25 === 0) {
          this.logProgress(
            `Working through the upload queue: checking file ${progress.completed + 1} of ${progress.total}.`,
            progress.completed === 0
          );
        }
        return;
      case "push-file-complete":
        this.statusUploadRate = formatRateNumber(progress.bytes, progress.startedAt);
        this.statusDownloadRate = "0";
        this.setStatus(`Upload ${progress.completed}/${progress.total} · ${formatRate(progress.bytes, progress.startedAt)}`);
        if (progress.completed === progress.total || progress.completed % 10 === 0) {
          this.logProgress(
            `Upload progress: checked ${progress.completed} of ${progress.total} file${progress.total === 1 ? "" : "s"} (${formatBytes(progress.bytes)} read, ${formatRate(progress.bytes, progress.startedAt)}).`,
            true
          );
        }
        return;
      case "push-complete":
        this.statusUploadRate = formatRateNumber(progress.bytes, progress.startedAt);
        this.statusDownloadRate = "0";
        this.setStatus(`Upload done · ${formatRate(progress.bytes, progress.startedAt)}`);
        this.logProgress(
          `Upload step finished: ${progress.pushed} uploaded, ${progress.deleted} deleted, ${progress.skipped} unchanged, ${progress.failed} failed (${formatBytes(progress.bytes)} read, ${formatRate(progress.bytes, progress.startedAt)}).`,
          true
        );
        return;
      case "pull-start":
        this.statusUploadRate = "0";
        this.statusDownloadRate = "0";
        this.setStatus("Checking downloads");
        this.logProgress(`Checking for changes from other devices from checkpoint ${formatCheckpoint(progress.since)}.`, true);
        return;
      case "pull-batch":
        this.statusUploadRate = "0";
        this.statusDownloadRate = formatRateNumber(progress.bytes, progress.startedAt);
        this.setStatus(`Down ${progress.completed}/${progress.total} · ${formatRate(progress.bytes, progress.startedAt)}`);
        this.logProgress(
          `Download progress: cached ${progress.completed} of ${progress.total} remote change${progress.total === 1 ? "" : "s"} (${formatBytes(progress.bytes)} received, ${formatRate(progress.bytes, progress.startedAt)}).`,
          progress.completed === progress.total || progress.completed % 25 === 0
        );
        return;
      case "pull-complete":
        this.statusUploadRate = "0";
        this.statusDownloadRate = progress.total > 0 ? formatRateNumber(progress.bytes, progress.startedAt) : "0";
        this.setStatus(progress.total > 0 ? `Down done · ${formatRate(progress.bytes, progress.startedAt)}` : "No downloads");
        this.logProgress(
          progress.total > 0
            ? `Download step finished: ${progress.total} remote change${progress.total === 1 ? "" : "s"} cached locally (${formatBytes(progress.bytes)} received, ${formatRate(progress.bytes, progress.startedAt)}). Saved CouchDB checkpoint ${formatCheckpoint(progress.lastSeq)}.`
            : `Download step finished: no remote changes found. Saved CouchDB checkpoint ${formatCheckpoint(progress.lastSeq)}.`,
          true
        );
        return;
      case "apply-start":
        this.statusUploadRate = "0";
        this.statusDownloadRate = "0";
        this.setStatus(`Apply ${progress.pending}`);
        this.logProgress(`Applying ${progress.pending} downloaded file${progress.pending === 1 ? "" : "s"} into the vault with backups before changes.`, true);
        return;
    }
  }

  private logProgress(message: string, important = false): void {
    const now = Date.now();
    if (!important && now - this.lastProgressLogAt < 10_000) {
      return;
    }
    this.lastProgressLogAt = now;
    this.log(message);
    this.scheduleRuntimeDiagnosticsSave();
  }

  private compactStatus(message: string): string {
    const trimmed = message.trim();
    if (!trimmed) {
      return this.formatStatusBar("Ready");
    }
    if (/loaded|ready|quiet|no action|batching|sync queued|queued sync|scheduled/i.test(trimmed)) {
      return this.formatStatusBar("Ready");
    }
    const upload = trimmed.match(/^Upload(?:ing)?\s+(\d+)\/(\d+)(?:\s+·\s+(.+))?$/i);
    if (upload) {
      return this.formatStatusBar("Syncing");
    }
    const download = trimmed.match(/^Down(?:load)?\s+(\d+)\/(\d+)(?:\s+·\s+(.+))?$/i);
    if (download) {
      return this.formatStatusBar("Syncing");
    }
    if (/upload done|down done|no downloads/i.test(trimmed)) {
      return this.formatStatusBar("Syncing");
    }
    if (/checking server|checking downloads|^apply \d+/i.test(trimmed)) {
      return this.formatStatusBar("Syncing");
    }
    if (/completed/i.test(trimmed)) {
      return this.formatStatusBar("Completed", "0", "0");
    }
    if (/^(Pushed|Uploaded) \d+/i.test(trimmed)) {
      return this.formatStatusBar("Completed", "0", "0");
    }
    if (/sync is running|sync queued|connecting|checking|retrying|scanning/i.test(trimmed)) {
      return this.formatStatusBar("Syncing");
    }
    if (/copied|uri ready|imported|connected|updated|passed|written/i.test(trimmed)) {
      return this.formatStatusBar("Ready");
    }
    if (/offline/i.test(trimmed)) {
      return this.formatStatusBar("Offline");
    }
    if (/failed|error|attention|could not|missing|locked|rejected|blocked/i.test(trimmed)) {
      return this.formatStatusBar("Issue");
    }
    return this.formatStatusBar("Ready");
  }

  private formatStatusBar(status: string, uploadRate = this.statusUploadRate, downloadRate = this.statusDownloadRate): string {
    return `${status} (${uploadRate}U/${downloadRate}D KBps)`;
  }

  private log(message: string): void {
    const safeMessage = this.redactLogMessage(message);
    const nextLog = [
      {
        timestamp: Date.now(),
        message: safeMessage
      },
      ...(this.settings.runtime.activityLog ?? [])
    ].slice(0, 60);
    this.settings = {
      ...this.settings,
      runtime: {
        ...this.settings.runtime,
        activityLog: nextLog
      }
    };
    console.log(`[Light-LiveSync] ${safeMessage}`);
    for (const listener of this.activityLogListeners) {
      try {
        listener();
      } catch (error) {
        console.warn("[Light-LiveSync] Activity log listener failed", error);
      }
    }
  }

  private redactLogMessage(message: string): string {
    return message
      .replace(/(password|passphrase)(["'\s:=]+)([^"',\s]+)/gi, "$1$2[hidden]")
      .replace(/(couchDB_PASSWORD|encryptedPassphrase|configPassphraseStore)(["'\s:=]+)([^"',\s]+)/gi, "$1$2[hidden]");
  }

  private logPreviewSummary(summary: ReconstructionBatchSummary): void {
    for (const preview of summary.previews) {
      const detail = preview.reason ? ` ${preview.reason}` : "";
      this.log(`Preview ${preview.status}: ${preview.path} (${preview.byteLength} bytes, ${preview.chunkCount} chunks).${detail}`);
    }
  }
}

function friendlySyncReason(reason: string): string {
  switch (reason) {
    case "manual":
      return "Manual";
    case "startup":
      return "Startup";
    case "periodic":
      return "Periodic";
    case "vault-change":
      return "Vault change";
    case "setup-import":
      return "Setup import";
    case "setup-qr-import":
      return "QR setup import";
    default:
      return reason || "Sync";
  }
}

function formatCheckpoint(value: string): string {
  if (!value) {
    return "0";
  }
  if (value.length <= 24) {
    return value;
  }
  return `${value.slice(0, 12)}...${value.slice(-8)}`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  if (bytes < 1000) {
    return `${Math.round(bytes)} B`;
  }
  const kb = bytes / 1000;
  if (kb < 1000) {
    return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  }
  const mb = kb / 1000;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

function formatRate(bytes: number, startedAt: number): string {
  return `${formatRateNumber(bytes, startedAt)} KBps`;
}

function formatRateNumber(bytes: number, startedAt: number): string {
  const elapsedSeconds = Math.max(0.5, (Date.now() - startedAt) / 1000);
  const kbPerSecond = Math.max(0, bytes / 1000 / elapsedSeconds);
  if (kbPerSecond < 10) {
    return kbPerSecond.toFixed(1);
  }
  return String(Math.round(kbPerSecond));
}
