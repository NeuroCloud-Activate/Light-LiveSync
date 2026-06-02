import { encrypt } from "octagonal-wheels/encryption/encryption";
import { CONFIG_URI_BASE } from "./setup-uri";
import type { LightweightLiveSyncSettings, UpstreamSetupSettings } from "./settings";

export class SetupUriExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SetupUriExportError";
  }
}

export function upstreamSetupFromRuntimeSettings(settings: LightweightLiveSyncSettings): UpstreamSetupSettings {
  return {
    couchDB_URI: settings.couchDb.uri,
    couchDB_DBNAME: settings.couchDb.database,
    couchDB_USER: settings.couchDb.username,
    couchDB_PASSWORD: settings.couchDb.password,
    couchDB_CustomHeaders: settings.couchDb.customHeaders,
    useRequestAPI: settings.couchDb.useRequestApi,
    passphrase: settings.passphrase,
    encrypt: true,
    E2EEAlgorithm: settings.e2eeAlgorithm,
    useDynamicIterationCount: settings.useDynamicIterationCount,
    usePathObfuscation: settings.usePathObfuscation,
    hashAlg: settings.hashAlgorithm,
    syncOnStart: settings.syncOnStart,
    syncOnSave: settings.syncOnSave,
    periodicReplication: settings.periodicSync,
    periodicReplicationInterval: settings.periodicSyncIntervalSec,
    syncMinimumInterval: settings.minimumSyncIntervalMs,
    concurrencyOfReadChunksOnline: settings.maxChunkFetchConcurrency
  };
}

export function validateSettingsForAdditionalDeviceUri(settings: LightweightLiveSyncSettings): void {
  if (!settings.configured || !settings.couchDb.uri || !settings.couchDb.database) {
    throw new SetupUriExportError("Connect this vault to CouchDB before generating an add-device URI.");
  }
  if (!settings.remoteState.syncParametersPresent) {
    throw new SetupUriExportError(
      "Check and initialize the remote database on this device before generating an add-device URI."
    );
  }
  if (!settings.couchDb.username || !settings.couchDb.password) {
    throw new SetupUriExportError("Unlock or update the CouchDB credentials before generating an add-device URI.");
  }
  if (settings.requireE2EE && !settings.passphrase) {
    throw new SetupUriExportError("Unlock or update the shared E2EE passphrase before generating an add-device URI.");
  }
}

export async function generateAdditionalDeviceSetupUri(
  settings: LightweightLiveSyncSettings,
  setupPassphrase = settings.passphrase
): Promise<string> {
  validateSettingsForAdditionalDeviceUri(settings);
  if (!setupPassphrase) {
    throw new SetupUriExportError("A setup passphrase is required to encrypt the add-device URI.");
  }

  const upstreamSettings = upstreamSetupFromRuntimeSettings(settings);
  const encryptedSettings = await encrypt(
    JSON.stringify(upstreamSettings),
    setupPassphrase,
    settings.useDynamicIterationCount
  );
  return `${CONFIG_URI_BASE}${encodeURIComponent(encryptedSettings)}`;
}
