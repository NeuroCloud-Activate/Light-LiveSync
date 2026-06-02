export type RemoteKind = "couchdb";
export type DeviceSetupRole = "initial-device" | "additional-device";

export type CouchDbSettings = {
  uri: string;
  database: string;
  username: string;
  password: string;
  customHeaders: string;
  useRequestApi: boolean;
};

export type EncryptedCredentialStore = {
  version: 1;
  kdf: "PBKDF2-SHA256";
  cipher: "AES-GCM";
  iterations: number;
  salt: string;
  iv: string;
  data: string;
  createdAt: number;
  updatedAt: number;
};

export type CredentialPayload = {
  couchDbPassword: string;
  passphrase: string;
};

export type LightweightLiveSyncSettings = {
  configured: boolean;
  remoteKind: RemoteKind;
  deviceSetupRole: DeviceSetupRole;
  couchDb: CouchDbSettings;
  requireE2EE: boolean;
  encrypt: boolean;
  passphrase: string;
  e2eeAlgorithm: string;
  useDynamicIterationCount: boolean;
  credentialStore: EncryptedCredentialStore | null;
  keepUnlockedDuringSession: boolean;
  usePathObfuscation: boolean;
  hashAlgorithm: string;
  syncOnStart: boolean;
  syncOnSave: boolean;
  autoApplyPull: boolean;
  periodicSync: boolean;
  useBackgroundWorker: boolean;
  vaultChangeBatchWindowSec: number;
  maxPushChangesPerSync: number;
  failedPushRetryBaseSec: number;
  failedPushRetryMaxSec: number;
  syncFailureCooldownSec: number;
  periodicSyncIntervalSec: number;
  minimumSyncIntervalMs: number;
  maxStorageApplyConcurrency: number;
  maxChunkFetchConcurrency: number;
  showAdvancedSettings: boolean;
  previewExportFolder: string;
  stagingApplyFolder: string;
  conflictFolder: string;
  remoteState: RemoteInspectionState;
  localQueue: LocalQueueState;
  localPreview: LocalPreviewState;
  localStaging: LocalStagingState;
  localLiveApply: LocalLiveApplyState;
  runtime: RuntimeDiagnosticsState;
  upstreamSettings: Record<string, unknown>;
};

export type UpstreamSetupSettings = Record<string, unknown>;

export type RemoteInspectionState = {
  lastCheckedAt: number;
  databaseName: string;
  documentCount: number;
  updateSequence: string;
  syncParametersPresent: boolean;
  milestonePresent: boolean;
  sampledNotes: number;
  sampledChunks: number;
  sampledDeleted: number;
  sampledUnknown: number;
  syncParameterSalt: string;
};

export type LocalQueueState = {
  lastPulledAt: number;
  lastRemoteSeq: string;
  files: number;
  chunks: number;
  deleted: number;
  pendingApply: number;
  pendingPush: number;
};

export type LocalPreviewState = {
  lastPreviewedAt: number;
  checked: number;
  ready: number;
  deleted: number;
  missingChunks: number;
  encryptedUnsupported: number;
  unsupported: number;
};

export type LocalStagingState = {
  lastStagedAt: number;
  staged: number;
  skipped: number;
  failed: number;
  folder: string;
};

export type LocalLiveApplyState = {
  lastAppliedAt: number;
  applied: number;
  deleted: number;
  skipped: number;
  merged: number;
  backedUp: number;
  conflicted: number;
  failed: number;
  conflictFolder: string;
};

export type RuntimeDiagnosticsState = {
  lastSyncReason: string;
  lastSyncStartedAt: number;
  lastSyncFinishedAt: number;
  lastSyncDurationMs: number;
  lastSyncOk: boolean;
  lastSyncMessage: string;
  lastSyncError: string;
  syncsStarted: number;
  syncsFinished: number;
  syncsFailed: number;
  lastSyncMetrics: RuntimeSyncMetricsState;
};

export type RuntimeSyncMetricsState = {
  inspectMs: number;
  pushMs: number;
  pullMs: number;
  applyMs: number;
  pushedFiles: number;
  deletedFiles: number;
  skippedFiles: number;
  failedFiles: number;
  pulledChanges: number;
  appliedFiles: number;
  mergedFiles: number;
  backedUpFiles: number;
  conflictedFiles: number;
  remoteDocsWritten: number;
  remoteDocsReused: number;
  remoteDocsConflicts: number;
  localBytesRead: number;
  chunkDocsBuilt: number;
};

export const DEFAULT_RUNTIME_SYNC_METRICS: RuntimeSyncMetricsState = {
  inspectMs: 0,
  pushMs: 0,
  pullMs: 0,
  applyMs: 0,
  pushedFiles: 0,
  deletedFiles: 0,
  skippedFiles: 0,
  failedFiles: 0,
  pulledChanges: 0,
  appliedFiles: 0,
  mergedFiles: 0,
  backedUpFiles: 0,
  conflictedFiles: 0,
  remoteDocsWritten: 0,
  remoteDocsReused: 0,
  remoteDocsConflicts: 0,
  localBytesRead: 0,
  chunkDocsBuilt: 0
};

export const DEFAULT_SETTINGS: LightweightLiveSyncSettings = {
  configured: false,
  remoteKind: "couchdb",
  deviceSetupRole: "initial-device",
  couchDb: {
    uri: "",
    database: "",
    username: "",
    password: "",
    customHeaders: "",
    useRequestApi: false
  },
  requireE2EE: true,
  encrypt: true,
  passphrase: "",
  e2eeAlgorithm: "v2",
  useDynamicIterationCount: false,
  credentialStore: null,
  keepUnlockedDuringSession: true,
  usePathObfuscation: true,
  hashAlgorithm: "xxhash64",
  syncOnStart: true,
  syncOnSave: true,
  autoApplyPull: true,
  periodicSync: true,
  useBackgroundWorker: true,
  vaultChangeBatchWindowSec: 60,
  maxPushChangesPerSync: 4,
  failedPushRetryBaseSec: 60,
  failedPushRetryMaxSec: 900,
  syncFailureCooldownSec: 120,
  periodicSyncIntervalSec: 300,
  minimumSyncIntervalMs: 30000,
  maxStorageApplyConcurrency: 1,
  maxChunkFetchConcurrency: 8,
  showAdvancedSettings: false,
  previewExportFolder: "",
  stagingApplyFolder: "",
  conflictFolder: "",
  remoteState: {
    lastCheckedAt: 0,
    databaseName: "",
    documentCount: 0,
    updateSequence: "",
    syncParametersPresent: false,
    milestonePresent: false,
    sampledNotes: 0,
    sampledChunks: 0,
    sampledDeleted: 0,
    sampledUnknown: 0,
    syncParameterSalt: ""
  },
  localQueue: {
    lastPulledAt: 0,
    lastRemoteSeq: "0",
    files: 0,
    chunks: 0,
    deleted: 0,
    pendingApply: 0,
    pendingPush: 0
  },
  localPreview: {
    lastPreviewedAt: 0,
    checked: 0,
    ready: 0,
    deleted: 0,
    missingChunks: 0,
    encryptedUnsupported: 0,
    unsupported: 0
  },
  localStaging: {
    lastStagedAt: 0,
    staged: 0,
    skipped: 0,
    failed: 0,
    folder: ""
  },
  localLiveApply: {
    lastAppliedAt: 0,
    applied: 0,
    deleted: 0,
    skipped: 0,
    merged: 0,
    backedUp: 0,
    conflicted: 0,
    failed: 0,
    conflictFolder: ""
  },
  runtime: {
    lastSyncReason: "",
    lastSyncStartedAt: 0,
    lastSyncFinishedAt: 0,
    lastSyncDurationMs: 0,
    lastSyncOk: true,
    lastSyncMessage: "",
    lastSyncError: "",
    syncsStarted: 0,
    syncsFinished: 0,
    syncsFailed: 0,
    lastSyncMetrics: { ...DEFAULT_RUNTIME_SYNC_METRICS }
  },
  upstreamSettings: {}
};

const SENSITIVE_UPSTREAM_KEYS = new Set([
  "couchDB_PASSWORD",
  "passphrase",
  "encryptedPassphrase",
  "encryptedCouchDBConnection",
  "configPassphraseStore",
  "remoteConfigurations"
]);

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function normaliseCouchDbUri(uri: string): string {
  if (!uri) {
    return "";
  }
  const trimmed = uri.trim();
  if (!trimmed) {
    return "";
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return `http://${trimmed}`.toLowerCase();
}

export function normaliseDatabaseName(database: string): string {
  return database.trim().toLowerCase();
}

function readRemoteConfiguration(settings: UpstreamSetupSettings): Partial<CouchDbSettings> {
  const remoteConfigurations = settings.remoteConfigurations;
  const activeConfigurationId = stringValue(settings.activeConfigurationId);
  if (!remoteConfigurations || typeof remoteConfigurations !== "object" || !activeConfigurationId) {
    return {};
  }

  const active = (remoteConfigurations as Record<string, unknown>)[activeConfigurationId];
  if (!active || typeof active !== "object") {
    return {};
  }

  const record = active as Record<string, unknown>;
  return {
    uri: normaliseCouchDbUri(stringValue(record.couchDB_URI ?? record.uri ?? record.server)),
    database: normaliseDatabaseName(stringValue(record.couchDB_DBNAME ?? record.database ?? record.dbName)),
    username: stringValue(record.couchDB_USER ?? record.username ?? record.user),
    password: stringValue(record.couchDB_PASSWORD ?? record.password),
    customHeaders: stringValue(record.couchDB_CustomHeaders ?? record.customHeaders),
    useRequestApi: booleanValue(record.useRequestAPI, false)
  };
}

export function settingsFromUpstreamSetup(upstream: UpstreamSetupSettings): LightweightLiveSyncSettings {
  const remote = {
    ...DEFAULT_SETTINGS.couchDb,
    uri: normaliseCouchDbUri(stringValue(upstream.couchDB_URI)),
    database: normaliseDatabaseName(stringValue(upstream.couchDB_DBNAME)),
    username: stringValue(upstream.couchDB_USER),
    password: stringValue(upstream.couchDB_PASSWORD),
    customHeaders: stringValue(upstream.couchDB_CustomHeaders),
    useRequestApi: booleanValue(upstream.useRequestAPI, false),
    ...readRemoteConfiguration(upstream)
  };

  const syncMinimumInterval = numberValue(upstream.syncMinimumInterval, DEFAULT_SETTINGS.minimumSyncIntervalMs);
  const periodicInterval = numberValue(upstream.periodicReplicationInterval, DEFAULT_SETTINGS.periodicSyncIntervalSec);

  return {
    ...DEFAULT_SETTINGS,
    configured: true,
    deviceSetupRole: "additional-device",
    couchDb: remote,
    requireE2EE: DEFAULT_SETTINGS.requireE2EE,
    encrypt: DEFAULT_SETTINGS.requireE2EE ? true : booleanValue(upstream.encrypt, DEFAULT_SETTINGS.encrypt),
    passphrase: stringValue(upstream.passphrase),
    e2eeAlgorithm: stringValue(upstream.E2EEAlgorithm) || DEFAULT_SETTINGS.e2eeAlgorithm,
    useDynamicIterationCount: booleanValue(upstream.useDynamicIterationCount, DEFAULT_SETTINGS.useDynamicIterationCount),
    usePathObfuscation: booleanValue(upstream.usePathObfuscation, DEFAULT_SETTINGS.usePathObfuscation),
    hashAlgorithm: stringValue(upstream.hashAlg) || DEFAULT_SETTINGS.hashAlgorithm,
    syncOnStart: booleanValue(upstream.syncOnStart, DEFAULT_SETTINGS.syncOnStart),
    syncOnSave: booleanValue(upstream.syncOnSave, DEFAULT_SETTINGS.syncOnSave),
    autoApplyPull: DEFAULT_SETTINGS.autoApplyPull,
    periodicSync: booleanValue(upstream.periodicReplication, DEFAULT_SETTINGS.periodicSync),
    vaultChangeBatchWindowSec: DEFAULT_SETTINGS.vaultChangeBatchWindowSec,
    maxPushChangesPerSync: DEFAULT_SETTINGS.maxPushChangesPerSync,
    failedPushRetryBaseSec: DEFAULT_SETTINGS.failedPushRetryBaseSec,
    failedPushRetryMaxSec: DEFAULT_SETTINGS.failedPushRetryMaxSec,
    syncFailureCooldownSec: DEFAULT_SETTINGS.syncFailureCooldownSec,
    periodicSyncIntervalSec: Math.max(30, periodicInterval),
    minimumSyncIntervalMs: Math.max(5000, syncMinimumInterval),
    maxChunkFetchConcurrency: Math.min(20, numberValue(upstream.concurrencyOfReadChunksOnline, 8)),
    showAdvancedSettings: DEFAULT_SETTINGS.showAdvancedSettings,
    upstreamSettings: sanitizeUpstreamSettings(upstream)
  };
}

export function hasUsableRemote(settings: LightweightLiveSyncSettings): boolean {
  return !!settings.couchDb.uri && !!settings.couchDb.database;
}

export function credentialPayloadFromSettings(settings: LightweightLiveSyncSettings): CredentialPayload {
  return {
    couchDbPassword: settings.couchDb.password,
    passphrase: settings.passphrase
  };
}

export function applyCredentialPayload(
  settings: LightweightLiveSyncSettings,
  payload: CredentialPayload
): LightweightLiveSyncSettings {
  return {
    ...settings,
    couchDb: {
      ...settings.couchDb,
      password: payload.couchDbPassword
    },
    passphrase: payload.passphrase
  };
}

export function hasCredentialPayload(payload: CredentialPayload): boolean {
  return !!payload.couchDbPassword || !!payload.passphrase;
}

export function credentialsAreLocked(settings: LightweightLiveSyncSettings): boolean {
  if (!settings.credentialStore) {
    return false;
  }
  if (settings.couchDb.username && !settings.couchDb.password) {
    return true;
  }
  return settings.encrypt && !settings.passphrase;
}

export function sanitizeUpstreamSettings(upstream: UpstreamSetupSettings): UpstreamSetupSettings {
  return Object.fromEntries(Object.entries(upstream).filter(([key]) => !SENSITIVE_UPSTREAM_KEYS.has(key)));
}

export function settingsForDisk(settings: LightweightLiveSyncSettings): LightweightLiveSyncSettings {
  return {
    ...settings,
    encrypt: settings.requireE2EE ? true : settings.encrypt,
    couchDb: {
      ...settings.couchDb,
      password: ""
    },
    passphrase: "",
    upstreamSettings: sanitizeUpstreamSettings(settings.upstreamSettings)
  };
}
