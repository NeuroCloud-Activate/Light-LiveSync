import { decodeAnyArray } from "octagonal-wheels/object";
import { CONFIG_URI_BASE_QR, SetupUriError } from "./setup-uri";
import type { UpstreamSetupSettings } from "./settings";

const KEY_INDEX_OF_SETTINGS: Record<string, number> = {
  remoteType: 0,
  useCustomRequestHandler: 1,
  couchDB_URI: 2,
  couchDB_USER: 3,
  couchDB_PASSWORD: 4,
  couchDB_DBNAME: 5,
  minimumChunkSize: 6,
  longLineThreshold: 7,
  encrypt: 8,
  passphrase: 9,
  usePathObfuscation: 10,
  checkIntegrityOnSave: 11,
  batch_size: 12,
  batches_limit: 13,
  useHistory: 14,
  disableRequestURI: 15,
  checkConflictOnlyOnOpen: 16,
  showMergeDialogOnlyOnActive: 17,
  additionalSuffixOfDatabaseName: 18,
  ignoreVersionCheck: 19,
  deleteMetadataOfDeletedFiles: 20,
  customChunkSize: 21,
  readChunksOnline: 22,
  automaticallyDeleteMetadataOfDeletedFiles: 23,
  useDynamicIterationCount: 24,
  permitEmptyPassphrase: 25,
  useTimeouts: 26,
  doNotPaceReplication: 27,
  hashCacheMaxCount: 28,
  hashCacheMaxAmount: 29,
  concurrencyOfReadChunksOnline: 30,
  minimumIntervalOfReadChunksOnline: 31,
  hashAlg: 32,
  enableCompression: 33,
  accessKey: 34,
  bucket: 35,
  endpoint: 36,
  region: 37,
  secretKey: 38,
  useEden: 39,
  maxChunksInEden: 40,
  maxTotalLengthInEden: 41,
  maxAgeInEden: 42,
  disableCheckingConfigMismatch: 43,
  handleFilenameCaseSensitive: 44,
  doNotUseFixedRevisionForChunks: 45,
  sendChunksBulk: 46,
  sendChunksBulkMaxSize: 47,
  useSegmenter: 48,
  liveSync: 49,
  syncOnSave: 50,
  syncOnStart: 51,
  syncOnFileOpen: 52,
  syncOnEditorSave: 53,
  syncMinimumInterval: 54,
  showVerboseLog: 55,
  lessInformationInLog: 56,
  showLongerLogInsideEditor: 57,
  showStatusOnEditor: 58,
  showStatusOnStatusbar: 59,
  showOnlyIconsOnEditor: 60,
  displayLanguage: 61,
  trashInsteadDelete: 62,
  doNotDeleteFolder: 63,
  batchSave: 64,
  batchSaveMinimumDelay: 64,
  batchSaveMaximumDelay: 65,
  syncMaxSizeInMB: 66,
  useIgnoreFiles: 67,
  ignoreFiles: 68,
  syncOnlyRegEx: 69,
  syncIgnoreRegEx: 70,
  syncAfterMerge: 71,
  resolveConflictsByNewerFile: 72,
  writeDocumentsIfConflicted: 73,
  disableMarkdownAutoMerge: 74,
  configPassphraseStore: 75,
  encryptedPassphrase: 76,
  encryptedCouchDBConnection: 77,
  periodicReplication: 78,
  periodicReplicationInterval: 79,
  syncInternalFiles: 80,
  syncInternalFilesBeforeReplication: 81,
  syncInternalFilesInterval: 82,
  syncInternalFilesIgnorePatterns: 83,
  watchInternalFileChanges: 84,
  suppressNotifyHiddenFilesChange: 85,
  usePluginSync: 86,
  usePluginSettings: 87,
  showOwnPlugins: 88,
  autoSweepPlugins: 89,
  autoSweepPluginsPeriodic: 90,
  notifyPluginOrSettingUpdated: 91,
  deviceAndVaultName: 92,
  usePluginSyncV2: 93,
  usePluginEtc: 94,
  pluginSyncExtendedSetting: 95,
  useAdvancedMode: 96,
  usePowerUserMode: 97,
  useEdgeCaseMode: 98,
  notifyThresholdOfRemoteStorageSize: 99,
  disableWorkerForGeneratingChunks: 100,
  processSmallFilesInUIThread: 101,
  enableChunkSplitterV2: 102,
  savingDelay: 103,
  gcDelay: 104,
  skipOlderFilesOnSync: 105,
  useIndexedDBAdapter: 106,
  enableDebugTools: 107,
  writeLogToTheFile: 108,
  settingSyncFile: 109,
  writeCredentialsForSettingSync: 110,
  notifyAllSettingSyncFile: 111,
  suspendFileWatching: 112,
  suspendParseReplicationResult: 113,
  doNotSuspendOnFetching: 114,
  versionUpFlash: 115,
  settingVersion: 116,
  isConfigured: 117,
  lastReadUpdates: 118,
  doctorProcessedVersion: 119,
  P2P_Enabled: 120,
  P2P_relays: 121,
  P2P_roomID: 122,
  P2P_passphrase: 123,
  P2P_AutoAccepting: 124,
  P2P_AutoStart: 125,
  P2P_AutoBroadcast: 126,
  P2P_AutoSyncPeers: 127,
  P2P_AutoWatchPeers: 128,
  P2P_SyncOnReplication: 129,
  P2P_AppID: 130,
  P2P_RebuildFrom: 131,
  bucketCustomHeaders: 132,
  couchDB_CustomHeaders: 133,
  useJWT: 134,
  jwtAlgorithm: 135,
  jwtKey: 136,
  jwtKid: 137,
  jwtSub: 138,
  jwtExpDuration: 139,
  P2P_AutoAcceptingPeers: 140,
  P2P_AutoDenyingPeers: 141,
  syncInternalFilesTargetPatterns: 142,
  useRequestAPI: 143,
  hideFileWarningNotice: 144,
  bucketPrefix: 145,
  chunkSplitterVersion: 146,
  E2EEAlgorithm: 147,
  processSizeMismatchedFiles: 148,
  forcePathStyle: 149,
  P2P_turnServers: 150,
  P2P_turnUsername: 151,
  P2P_turnCredential: 152,
  syncInternalFileOverwritePatterns: 153,
  useOnlyLocalChunk: 154,
  maxMTimeForReflectEvents: 155,
  networkWarningStyle: 156,
  remoteConfigurations: 157,
  activeConfigurationId: 158,
  P2P_ActiveRemoteConfigurationId: 159,
  autoAcceptCompatibleTweak: 160
};

function extractSetupQrPayload(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new SetupUriError("Setup QR payload is empty.");
  }

  if (trimmed.startsWith(CONFIG_URI_BASE_QR)) {
    return trimmed.slice(CONFIG_URI_BASE_QR.length);
  }

  try {
    const parsed = new URL(trimmed);
    const settingsQr = parsed.searchParams.get("settingsQR");
    if (settingsQr) {
      return settingsQr;
    }
  } catch {
    // The Obsidian protocol handler passes the payload value rather than a full URL.
  }

  return trimmed;
}

export function decodeSettingsFromSetupQr(qrOrPayload: string): UpstreamSetupSettings {
  const payload = decodeURIComponent(extractSetupQrPayload(qrOrPayload));
  const settingArray = decodeAnyArray(payload) as unknown;
  if (!Array.isArray(settingArray)) {
    throw new SetupUriError("Setup QR payload did not decode to a settings array.");
  }

  const settings: UpstreamSetupSettings = {};
  for (const [key, index] of Object.entries(KEY_INDEX_OF_SETTINGS)) {
    if (index < 0 || index >= settingArray.length || settingArray[index] === undefined) {
      continue;
    }
    settings[key] = settingArray[index];
  }
  return settings;
}
