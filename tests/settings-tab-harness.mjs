import assert from "node:assert/strict";
import { LightweightLiveSyncSettingTab } from "../src/settings-tab.ts";
import { DEFAULT_SETTINGS } from "../src/settings.ts";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function render(settingsPatch) {
  const plugin = {
    app: {
      vault: {
        configDir: ".obsidian"
      }
    },
    settings: {
      ...clone(DEFAULT_SETTINGS),
      ...settingsPatch,
      couchDb: {
        ...clone(DEFAULT_SETTINGS.couchDb),
        ...(settingsPatch.couchDb ?? {})
      },
      remoteState: {
        ...clone(DEFAULT_SETTINGS.remoteState),
        ...(settingsPatch.remoteState ?? {})
      },
      localQueue: {
        ...clone(DEFAULT_SETTINGS.localQueue),
        ...(settingsPatch.localQueue ?? {})
      },
      localPreview: {
        ...clone(DEFAULT_SETTINGS.localPreview),
        ...(settingsPatch.localPreview ?? {})
      },
      localStaging: {
        ...clone(DEFAULT_SETTINGS.localStaging),
        ...(settingsPatch.localStaging ?? {})
      },
      localLiveApply: {
        ...clone(DEFAULT_SETTINGS.localLiveApply),
        ...(settingsPatch.localLiveApply ?? {})
      },
      runtime: {
        ...clone(DEFAULT_SETTINGS.runtime),
        ...(settingsPatch.runtime ?? {}),
        lastSyncMetrics: {
          ...clone(DEFAULT_SETTINGS.runtime.lastSyncMetrics),
          ...(settingsPatch.runtime?.lastSyncMetrics ?? {})
        }
      }
    },
    promptForDirectSetup() {},
    promptForSetupUri() {},
    generateSetupUriForAdditionalDevice() {},
    copyCouchDbSetupCommandFromSettings() {},
    promptForServerCredentials() {},
    initializeRemoteSyncParameters() {},
    verifyConnectionNow() {},
    setAutoUnlockCredentials() {},
    syncNow() {},
    applyPullToVault() {},
    previewQueuedPull() {},
    saveSettingsAndReschedule() {},
    resetLocalSyncState() {},
    getRuntimeSettings() {
      return this.settings;
    }
  };
  const tab = new LightweightLiveSyncSettingTab(plugin);
  tab.display();
  return tab.containerEl.textContent;
}

const unconfigured = render({
  runtime: {
    lastSyncStartedAt: Date.now() - 1000,
    lastSyncFinishedAt: Date.now(),
    lastSyncOk: false,
    lastSyncError: "Light-LiveSync is not configured.",
    syncsStarted: 1,
    syncsFinished: 1,
    syncsFailed: 1
  }
});
assert.match(unconfigured, /Recommended next step/);
assert.match(unconfigured, /Connect this vault/);
assert.match(unconfigured, /Connect CouchDB/);
assert.match(unconfigured, /A low-noise vault sync setup/);
assert.match(unconfigured, /Sync activity/);
assert.match(unconfigured, /Advanced/);
assert.doesNotMatch(unconfigured, /View/);
assert.doesNotMatch(unconfigured, /current/);
assert.match(unconfigured, /Connection check/);
assert.match(unconfigured, /without syncing vault files/);
assert.match(unconfigured, /Add another device/);
assert.match(unconfigured, /Generate URI/);
assert.match(unconfigured, /Create database from terminal/);
assert.match(unconfigured, /Copy setup command/);
assert.match(unconfigured, /passphrases are not saved unless setup succeeds/);
assert.doesNotMatch(unconfigured, /Runtime check/);
assert.doesNotMatch(unconfigured, /Run check/);
assert.doesNotMatch(unconfigured, /Check device APIs/);
assert.doesNotMatch(unconfigured, /Safety/);
assert.doesNotMatch(unconfigured, /Show advanced settings/);
assert.doesNotMatch(unconfigured, /Sync failure cooldown/);
assert.doesNotMatch(unconfigured, /Custom request headers/);

const locked = render({
  configured: true,
  couchDb: {
    uri: "http://example.com:5984",
    database: "vault",
    username: "user",
    password: ""
  },
  credentialStore: { version: 1 },
  passphrase: ""
});
assert.match(locked, /Refresh saved credentials/);
assert.match(locked, /Update saved credentials/);
assert.doesNotMatch(locked, /Unlock/);

const firstRun = render({
  configured: true,
  couchDb: {
    uri: "http://example.com:5984",
    database: "vault",
    username: "user",
    password: "password"
  },
  passphrase: "secret"
});
assert.match(firstRun, /Check the connection/);
assert.match(firstRun, /Check connection/);
assert.match(firstRun, /before syncing files/);

const failed = render({
  configured: true,
  couchDb: {
    uri: "http://example.com:5984",
    database: "vault",
    username: "user",
    password: "password"
  },
  passphrase: "secret",
  remoteState: {
    lastCheckedAt: Date.now(),
    syncParametersPresent: true
  },
  runtime: {
    lastSyncStartedAt: Date.now() - 1000,
    lastSyncFinishedAt: Date.now(),
    lastSyncOk: false,
    lastSyncError: "net::ERR_ADDRESS_UNREACHABLE",
    syncsStarted: 1,
    syncsFinished: 1,
    syncsFailed: 1
  }
});
assert.match(failed, /Last sync needs attention/);
assert.match(failed, /CouchDB could not be reached/);
assert.match(failed, /Try sync again/);

const additionalMissingParameters = render({
  configured: true,
  deviceSetupRole: "additional-device",
  couchDb: {
    uri: "http://example.com:5984",
    database: "vault",
    username: "user",
    password: "password"
  },
  passphrase: "secret",
  remoteState: {
    lastCheckedAt: Date.now(),
    syncParametersPresent: false
  }
});
assert.match(additionalMissingParameters, /Use the original device to initialize/);
assert.doesNotMatch(additionalMissingParameters, /Initialize remote/);
assert.match(additionalMissingParameters, /without creating the database or preparing sync parameters/);

const pendingApply = render({
  configured: true,
  couchDb: {
    uri: "http://example.com:5984",
    database: "vault",
    username: "user",
    password: "password"
  },
  passphrase: "secret",
  remoteState: {
    lastCheckedAt: Date.now(),
    syncParametersPresent: true
  },
  localQueue: {
    pendingApply: 2
  }
});
assert.match(pendingApply, /Remote changes are ready/);
assert.match(pendingApply, /Apply next/);
assert.match(pendingApply, /automatically and backups are created first/);

const activity = render({
  settingsTab: "activity",
  configured: true,
  couchDb: {
    uri: "http://example.com:5984",
    database: "vault",
    username: "user",
    password: "password"
  },
  passphrase: "secret",
  remoteState: {
    lastCheckedAt: Date.now(),
    syncParametersPresent: true
  },
  runtime: {
    lastSyncMetrics: {
      inspectMs: 5,
      pushMs: 12,
      pullMs: 8,
      applyMs: 4,
      pushedFiles: 1,
      pulledChanges: 2,
      appliedFiles: 1,
      mergedFiles: 1,
      backedUpFiles: 1,
      remoteDocsWritten: 3,
      remoteDocsReused: 2,
      localBytesRead: 191,
      chunkDocsBuilt: 1
    }
  }
});
assert.match(activity, /Sync activity/);
assert.match(activity, /CouchDB connection/);
assert.match(activity, /Server address/);
assert.match(activity, /http:\/\/example.com:5984/);
assert.match(activity, /Username/);
assert.match(activity, /user/);
assert.match(activity, /Database name/);
assert.match(activity, /vault/);
assert.match(activity, /Last sync workload/);
assert.match(activity, /Uploaded 1 file \(191 B read locally, 1 chunk doc built\)/);
assert.doesNotMatch(activity, /Advanced sync tuning/);

const advanced = render({
  settingsTab: "advanced",
  configured: true,
  couchDb: {
    uri: "http://example.com:5984",
    database: "vault",
    username: "user",
    password: "password"
  },
  passphrase: "secret"
});
assert.match(advanced, /Advanced sync tuning/);
assert.match(advanced, /Sync failure cooldown/);
assert.match(advanced, /Manual Sync now can still run immediately/);
assert.match(advanced, /Custom request headers/);
assert.doesNotMatch(advanced, /Remote database/);

console.log(JSON.stringify({
  ok: true,
  renderedStates: ["unconfigured", "locked", "firstRun", "failed", "additionalMissingParameters", "pendingApply", "activity", "advanced"],
  hasRecommendedNextStep: /Recommended next step/.test(unconfigured),
  hasFriendlyFailure: /CouchDB could not be reached/.test(failed),
  hasAddDeviceUriAction: /Generate URI/.test(unconfigured),
  additionalDeviceDoesNotOfferInitialize: !/Initialize remote/.test(additionalMissingParameters),
  hasAutomaticApplyGuidance: /automatically and backups are created first/.test(pendingApply),
  hidesAdvancedByDefault: !/Sync failure cooldown/.test(unconfigured),
  hasActivityTab: /Last sync workload/.test(activity),
  showsAdvancedOnRequest: /Sync failure cooldown/.test(advanced)
}, null, 2));
