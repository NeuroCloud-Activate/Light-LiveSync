import { PluginSettingTab, Setting } from "obsidian";
import type LightweightLiveSyncPlugin from "./main";
import { credentialsAreLocked, normaliseCouchDbUri, normaliseDatabaseName } from "./settings";

type SettingsContainer = HTMLElement;
type SettingsTabId = "sync" | "activity" | "advanced";

export class LightweightLiveSyncSettingTab extends PluginSettingTab {
  private readonly plugin: LightweightLiveSyncPlugin;

  constructor(plugin: LightweightLiveSyncPlugin) {
    super(plugin.app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("light-livesync-settings");
    new Setting(containerEl).setName("Light-LiveSync").setHeading();
    containerEl.createEl("p", {
      text: "A low-noise vault sync setup for CouchDB. Defaults favor encrypted sync, small batches, automatic text merges, and recovery backups."
    });
    this.renderTabs(containerEl);

    switch (this.activeTab()) {
      case "activity":
        this.renderStatusSection(containerEl);
        break;
      case "advanced":
        this.renderAdvancedTab(containerEl);
        break;
      case "sync":
      default:
        this.renderSyncTab(containerEl);
        break;
    }
  }

  private activeTab(): SettingsTabId {
    return this.plugin.settings.settingsTab ?? "sync";
  }

  private renderTabs(containerEl: SettingsContainer): void {
    const active = this.activeTab();
    const tabs = containerEl.createEl("div");
    tabs.addClass("light-livesync-tabs");
    const tabSpecs: { id: SettingsTabId; label: string }[] = [
      { id: "sync", label: "Sync" },
      { id: "activity", label: "Sync activity" },
      { id: "advanced", label: "Advanced" }
    ];

    for (const tabSpec of tabSpecs) {
      const tab = tabs.createEl("button", { text: tabSpec.label });
      tab.addClass("light-livesync-tab");
      tab.setAttr("type", "button");
      tab.setAttr("aria-pressed", String(active === tabSpec.id));
      if (active === tabSpec.id) {
        tab.addClass("is-active");
      }
      tab.onclick = async () => {
        this.plugin.settings.settingsTab = tabSpec.id;
        await this.plugin.saveSettingsAndReschedule();
        this.display();
      };
    }
  }

  private renderSyncTab(containerEl: SettingsContainer): void {
    this.renderSetupSection(containerEl);
    this.renderConnectionSection(containerEl);
    this.renderAutomaticSyncSummary(containerEl);
  }

  private renderAdvancedTab(containerEl: SettingsContainer): void {
    this.renderSecuritySection(containerEl);
    this.renderAdvancedConnectionSection(containerEl);
    this.renderSchedulerSection(containerEl);
    this.renderFolderSection(containerEl);
  }

  private section(containerEl: SettingsContainer, title: string): SettingsContainer {
    new Setting(containerEl).setName(title).setHeading();
    return containerEl;
  }

  private async saveConnectionChange(resetLocalState: boolean): Promise<void> {
    this.plugin.settings.configured = !!this.plugin.settings.couchDb.uri && !!this.plugin.settings.couchDb.database;
    if (resetLocalState) {
      await this.plugin.resetLocalSyncState();
    }
    await this.plugin.saveSettingsAndReschedule();
  }

  private renderHealthSection(containerEl: SettingsContainer): void {
    this.section(containerEl, "Recommended next step");
    const runtime = this.plugin.settings.runtime;
    const queue = this.plugin.settings.localQueue;
    const remote = this.plugin.settings.remoteState;

    if (!this.plugin.settings.configured) {
      new Setting(containerEl)
        .setName("Connect this vault")
        .setDesc("Start here. Use the CouchDB fields from your setup script, or import an existing Self-hosted LiveSync setup URI.")
        .addButton((button) => {
          button.setButtonText("Connect CouchDB").setCta().onClick(async () => {
            await this.plugin.promptForDirectSetup();
            this.display();
          });
        })
        .addButton((button) => {
          button.setButtonText("Use setup URI").onClick(async () => {
            await this.plugin.promptForSetupUri();
            this.display();
          });
        });
      return;
    }

    if (credentialsAreLocked(this.plugin.getRuntimeSettings())) {
      new Setting(containerEl)
        .setName("Refresh saved credentials")
        .setDesc("Saved credentials could not be opened automatically on this device. Update them once so sync can continue without a recurring prompt.")
        .addButton((button) => {
          button.setButtonText("Update saved credentials").setCta().onClick(async () => {
            await this.plugin.promptForServerCredentials();
            this.display();
          });
        });
      return;
    }

    const runtimeSettings = this.plugin.getRuntimeSettings();
    if (runtimeSettings.requireE2EE && !runtimeSettings.passphrase) {
      new Setting(containerEl)
        .setName("Add the vault encryption passphrase")
        .setDesc("Encrypted sync is required. Add the shared E2EE passphrase used by your other devices before sending or applying files.")
        .addButton((button) => {
          button.setButtonText("Update credentials").setCta().onClick(async () => {
            await this.plugin.promptForServerCredentials();
            this.display();
          });
        });
      return;
    }

    if (remote.lastCheckedAt > 0 && !remote.syncParametersPresent) {
      const setting = new Setting(containerEl)
        .setName("Prepare the remote database")
        .setDesc(
          this.plugin.settings.deviceSetupRole === "additional-device"
            ? "The database is reachable but missing LiveSync sync parameters. Use the original device to initialize the database, then check this device again."
            : "The database is reachable but missing LiveSync sync parameters. This plugin can create them safely before syncing."
        );
      if (this.plugin.settings.deviceSetupRole === "initial-device") {
        setting.addButton((button) => {
          button.setButtonText("Initialize remote").setCta().onClick(async () => {
            await this.plugin.initializeRemoteSyncParameters();
            this.display();
          });
        });
      }
      return;
    }

    if (remote.lastCheckedAt === 0) {
      new Setting(containerEl)
        .setName("Check the connection")
        .setDesc("Setup is saved, but this device has not checked the remote database yet. Verify the credentials, database, and sync parameters before syncing files.")
        .addButton((button) => {
          button.setButtonText("Check connection").setCta().onClick(async () => {
            await this.plugin.verifyConnectionNow();
            this.display();
          });
        });
      return;
    }

    if (runtime.lastSyncFinishedAt === 0 && runtime.lastSyncStartedAt > 0) {
      new Setting(containerEl)
        .setName("Sync is running")
        .setDesc("The current sync is still in progress. New sync requests are folded into the next run instead of starting another one.");
      return;
    }

    if (runtime.lastSyncError) {
      new Setting(containerEl)
        .setName("Last sync needs attention")
        .setDesc(`${friendlyError(runtime.lastSyncError)} The plugin kept pending changes queued so they can retry safely.`)
        .addButton((button) => {
          button.setButtonText("Try sync again").setCta().onClick(async () => {
            await this.plugin.syncNow();
            this.display();
          });
        })
        .addButton((button) => {
          button.setButtonText("Update credentials").onClick(async () => {
            await this.plugin.promptForServerCredentials();
            this.display();
          });
        });
      return;
    }

    if (queue.pendingPush > 0) {
      new Setting(containerEl)
        .setName("Local changes are queued")
        .setDesc(`${queue.pendingPush} local change${queue.pendingPush === 1 ? "" : "s"} will upload in small batches. Sync now if you want to start immediately.`)
        .addButton((button) => {
          button.setButtonText("Sync now").setCta().onClick(async () => {
            await this.plugin.syncNow();
            this.display();
          });
        });
      return;
    }

    if (queue.pendingApply > 0) {
      new Setting(containerEl)
        .setName("Remote changes are ready")
        .setDesc(`${queue.pendingApply} pulled file${queue.pendingApply === 1 ? "" : "s"} can be applied. Text differences are merged automatically and backups are created first.`)
        .addButton((button) => {
          button.setButtonText("Apply next").setCta().onClick(async () => {
            await this.plugin.applyPullToVault();
            this.display();
          });
        })
        .addButton((button) => {
          button.setButtonText("Preview").onClick(async () => {
            await this.plugin.previewQueuedPull();
            this.display();
          });
        });
      return;
    }

    new Setting(containerEl)
      .setName("Ready")
      .setDesc("No action is needed right now. Live changes are batched, periodic sync remains as a fallback, and conflicts are handled with automatic text merges plus backups.");
  }

  private renderSetupSection(containerEl: SettingsContainer): void {
    this.section(containerEl, "Setup");

    new Setting(containerEl)
      .setName("Step 1. Connect this vault")
      .setDesc(
        this.plugin.settings.configured
          ? this.plugin.settings.deviceSetupRole === "additional-device"
            ? "This vault was added from a setup URI. It verifies and syncs with the existing CouchDB database without creating it."
            : "This vault is the initial device for this database. It can create or initialize the CouchDB database when needed."
          : "Prepare a server-side setup command, or paste a setup URI generated by another device or by the setup command."
      )
      .addButton((button) => {
        button.setButtonText("Prepare command").setCta().onClick(async () => {
          await this.plugin.promptForDirectSetup();
          this.display();
        });
      })
      .addButton((button) => {
        button.setButtonText("Use setup URI").onClick(async () => {
          await this.plugin.promptForSetupUri();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName("Step 2. Create or verify the CouchDB database")
      .setDesc("Use Copy setup command, then run the copied Deno command directly on the self-hosted server side where CouchDB is reachable, such as your server terminal, SSH session, or Docker container console for the CouchDB service. If creating a new sync user or database, replace the admin_username/admin_password placeholders with an existing CouchDB admin. The command creates or verifies the database, prepares sync parameters, and prints a setup URI to paste into Use setup URI.")
      .addButton((button) => {
        button.setButtonText("Copy setup command").onClick(async () => {
          await this.plugin.copyCouchDbSetupCommandFromSettings();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName("Step 3. Check the connection")
      .setDesc(
        this.plugin.settings.deviceSetupRole === "additional-device"
          ? "Verifies the saved credentials and existing database without creating the database or preparing sync parameters."
          : "Verifies the saved credentials, creates or reuses the selected database when permissions allow it, and prepares sync parameters without syncing vault files."
      )
      .addButton((button) => {
        button.setButtonText("Check connection").onClick(async () => {
          await this.plugin.verifyConnectionNow();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName("Step 4. Add another device")
      .setDesc("Generate an encrypted setup URI for a phone, tablet, or another desktop. The remote database must already be initialized here; the new device only imports the URI and syncs.")
      .addButton((button) => {
        button.setButtonText("Generate URI").onClick(async () => {
          await this.plugin.generateSetupUriForAdditionalDevice();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName("Saved credentials")
      .setDesc(this.credentialsDescription())
      .addButton((button) => {
        button.setButtonText("Update saved credentials").onClick(async () => {
          await this.plugin.promptForServerCredentials();
          this.display();
        });
      });
  }

  private credentialsDescription(): string {
    if (!this.plugin.settings.credentialStore) {
      return "No encrypted server password or vault passphrase is saved yet. Add them during setup or with Update.";
    }
    return credentialsAreLocked(this.plugin.getRuntimeSettings())
      ? "Saved encrypted, but this device could not open them automatically. Update them once to refresh this device."
      : "Saved encrypted and available on this device for background sync after app start.";
  }

  private renderAutomaticSyncSummary(containerEl: SettingsContainer): void {
    this.section(containerEl, "Automatic sync");
    new Setting(containerEl)
      .setName("Runs quietly in the background")
      .setDesc(
        `Local edits are batched for ${this.plugin.settings.vaultChangeBatchWindowSec} seconds, each run can upload up to ${this.plugin.settings.maxPushChangesPerSync} changed files, failed syncs cool down for ${this.plugin.settings.syncFailureCooldownSec} seconds, and periodic fallback checks every ${this.plugin.settings.periodicSyncIntervalSec} seconds.`
      )
      .addButton((button) => {
        button.setButtonText("Sync now").onClick(async () => {
          await this.plugin.syncNow();
          this.display();
        });
      });
  }

  private renderConnectionSection(containerEl: SettingsContainer): void {
    this.section(containerEl, "Connection");
    this.renderCouchDbServer(containerEl);
    this.renderCouchDbDatabase(containerEl);
    this.renderCouchDbUsername(containerEl);
    this.renderConnectionCheck(containerEl);
  }

  private renderAdvancedConnectionSection(containerEl: SettingsContainer): void {
    this.section(containerEl, "Advanced connection");
    this.renderCustomHeaders(containerEl);
    new Setting(containerEl)
      .setName("Use request API")
      .setDesc("Leave off for the standard fetch transport. Turn on only if your platform, proxy, or CORS setup needs the app request handling mode.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.couchDb.useRequestApi).onChange(async (value) => {
          this.plugin.settings.couchDb.useRequestApi = value;
          await this.plugin.saveSettingsAndReschedule();
        });
      });
  }

  private renderCouchDbServer(containerEl: SettingsContainer): void {
    new Setting(containerEl)
      .setName("CouchDB server")
      .setDesc("Where your CouchDB server lives, for example host:5984 or https://host:5984. This is never hardwired.")
      .addText((text) => {
        text
          .setPlaceholder("https://example.com:5984")
          .setValue(this.plugin.settings.couchDb.uri)
          .onChange(async (value) => {
            this.plugin.settings.couchDb.uri = normaliseCouchDbUri(value);
            await this.saveConnectionChange(true);
          });
      });
  }

  private renderCouchDbDatabase(containerEl: SettingsContainer): void {
    new Setting(containerEl)
      .setName("CouchDB database")
      .setDesc("The vault database to create or reuse on the server. CouchDB needs lowercase names, so this field is normalized automatically.")
      .addText((text) => {
        text
          .setPlaceholder("my_vault")
          .setValue(this.plugin.settings.couchDb.database)
          .onChange(async (value) => {
            this.plugin.settings.couchDb.database = normaliseDatabaseName(value);
            await this.saveConnectionChange(true);
          });
      });
  }

  private renderCouchDbUsername(containerEl: SettingsContainer): void {
    new Setting(containerEl)
      .setName("CouchDB username")
      .setDesc("The CouchDB account that can read, write, and create the selected database.")
      .addText((text) => {
        text.setValue(this.plugin.settings.couchDb.username).onChange(async (value) => {
          this.plugin.settings.couchDb.username = value.trim();
          await this.saveConnectionChange(false);
        });
      });
  }

  private renderConnectionCheck(containerEl: SettingsContainer): void {
    new Setting(containerEl)
      .setName("Connection check")
      .setDesc(
        this.plugin.settings.deviceSetupRole === "additional-device"
          ? "Verifies the saved credentials and existing database without creating the database or preparing sync parameters. Add-device setup should be initialized from the original device."
          : "Verifies the saved credentials, creates or reuses the selected database, and prepares sync parameters without syncing vault files."
      )
      .addButton((button) => {
        button.setButtonText("Check connection").onClick(async () => {
          await this.plugin.verifyConnectionNow();
          this.display();
        });
      });
  }

  private renderCustomHeaders(containerEl: SettingsContainer): void {
    new Setting(containerEl)
      .setName("Custom request headers")
      .setDesc("Optional advanced proxy headers, one per line as Name: value. Leave blank for a normal CouchDB server.")
      .addTextArea((text) => {
        text.inputEl.rows = 3;
        text.setValue(this.plugin.settings.couchDb.customHeaders).onChange(async (value) => {
          this.plugin.settings.couchDb.customHeaders = value;
          await this.plugin.saveSettingsAndReschedule();
        });
      });
  }

  private renderSecuritySection(containerEl: SettingsContainer): void {
    this.section(containerEl, "Advanced security");

    new Setting(containerEl)
      .setName("Require E2EE")
      .setDesc("Recommended. Sync will not send or apply vault content unless the shared encryption passphrase is available.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.requireE2EE).onChange(async (value) => {
          this.plugin.settings.requireE2EE = value;
          if (value) {
            this.plugin.settings.encrypt = true;
          }
          await this.plugin.saveSettingsAndReschedule();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName("Encrypt note content")
      .setDesc(this.plugin.settings.requireE2EE ? "Locked on because E2EE is required." : "Encrypt note and attachment contents before they are written to CouchDB.")
      .addToggle((toggle) => {
        toggle
          .setDisabled(this.plugin.settings.requireE2EE)
          .setValue(this.plugin.settings.requireE2EE ? true : this.plugin.settings.encrypt)
          .onChange(async (value) => {
            this.plugin.settings.encrypt = this.plugin.settings.requireE2EE ? true : value;
            await this.plugin.saveSettingsAndReschedule();
          });
      });
  }

  private renderSchedulerSection(containerEl: SettingsContainer): void {
    this.section(containerEl, "Advanced sync tuning");
    containerEl.createEl("p", {
      text: "Defaults are tuned for slow or unreliable connections: changes wait briefly, upload in small groups, and retry later after failures."
    });
    this.renderBooleanSetting(containerEl, "Sync on startup", "syncOnStart", "Checks the server once Obsidian opens so this device catches up without you pressing a button.");
    this.renderBooleanSetting(containerEl, "Sync after vault changes", "syncOnSave", "Queues one batched sync after edits, creates, deletes, and renames. It does not sync every keystroke.");
    this.renderBooleanSetting(containerEl, "Automatically apply pulled files", "autoApplyPull", "Applies one ready remote file per sync. Text differences are merged automatically and a recovery backup is created first.");
    this.renderBooleanSetting(containerEl, "Use background worker", "useBackgroundWorker", "Moves chunking, hashing, and encryption off the main Obsidian thread when the device supports it. If it fails, the plugin falls back automatically.");
    this.renderPeriodicSync(containerEl);
    this.renderNumberSetting(containerEl, "Vault change batch window", "vaultChangeBatchWindowSec", 5, "Seconds to wait after local changes before syncing. Higher values use less data on poor connections.");
    this.renderNumberSetting(containerEl, "Max files uploaded per sync", "maxPushChangesPerSync", 1, "Upper bound for changed files uploaded in one run. The default is high enough for full-vault first syncs while fingerprints skip unchanged files.");
    this.renderNumberSetting(containerEl, "First retry after failed upload", "failedPushRetryBaseSec", 5, "Seconds before retrying a failed upload. The changed file stays queued safely.");
    this.renderNumberSetting(containerEl, "Longest retry delay", "failedPushRetryMaxSec", 30, "Maximum seconds between retry attempts for the same failed upload.");
    this.renderNumberSetting(containerEl, "Sync failure cooldown", "syncFailureCooldownSec", 30, "Seconds automatic sync waits after a failed run before trying again. Manual Sync now can still run immediately.");
    this.renderNumberSetting(containerEl, "Periodic fallback interval", "periodicSyncIntervalSec", 30, "Seconds between fallback checks for missed events, sleeping devices, or mobile interruptions.");
    this.renderNumberSetting(containerEl, "Minimum time between syncs", "minimumSyncIntervalMs", 5000, "Milliseconds. Startup, manual, save-triggered, and periodic sync requests all share this throttle.");
  }

  private renderBooleanSetting(
    containerEl: SettingsContainer,
    name: string,
    key: "syncOnStart" | "syncOnSave" | "autoApplyPull" | "useBackgroundWorker",
    description?: string
  ): void {
    const setting = new Setting(containerEl).setName(name);
    if (description) {
      setting.setDesc(description);
    }
    setting.addToggle((toggle) => {
      toggle.setValue(this.plugin.settings[key]).onChange(async (value) => {
        this.plugin.settings[key] = value;
        await this.plugin.saveSettingsAndReschedule();
      });
    });
  }

  private renderPeriodicSync(containerEl: SettingsContainer): void {
    new Setting(containerEl)
      .setName("Periodic sync")
      .setDesc("Recommended fallback. Catches changes missed while a device was asleep, offline, or backgrounded.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.periodicSync).onChange(async (value) => {
          this.plugin.settings.periodicSync = value;
          await this.plugin.saveSettingsAndReschedule();
          this.display();
        });
      });
  }

  private renderNumberSetting(
    containerEl: SettingsContainer,
    name: string,
    key: "periodicSyncIntervalSec" | "minimumSyncIntervalMs" | "vaultChangeBatchWindowSec" | "maxPushChangesPerSync" | "failedPushRetryBaseSec" | "failedPushRetryMaxSec" | "syncFailureCooldownSec",
    minimum: number,
    description: string
  ): void {
    new Setting(containerEl)
      .setName(name)
      .setDesc(description)
      .addText((text) => {
        text.setValue(String(this.plugin.settings[key])).onChange(async (value) => {
          const parsed = Number(value);
          if (Number.isFinite(parsed)) {
            this.plugin.settings[key] = Math.max(minimum, Math.round(parsed));
            await this.plugin.saveSettingsAndReschedule();
          }
        });
      });
  }

  private renderFolderSection(containerEl: SettingsContainer): void {
    this.section(containerEl, "Advanced folders");
    this.renderFolderSetting(
      containerEl,
      "Preview export folder",
      "previewExportFolder",
      "preview",
      "Where preview exports go. This never changes live notes unless you later apply them."
    );
    this.renderFolderSetting(
      containerEl,
      "Staging apply folder",
      "stagingApplyFolder",
      "staging",
      "Optional safe landing area for pulled files before writing them into the live vault."
    );
    this.renderFolderSetting(
      containerEl,
      "Conflict folder",
      "conflictFolder",
      "conflicts",
      "Recovery backups are stored here before a merge, overwrite, or delete. Keep this inside the vault for easy inspection."
    );
  }

  private renderFolderSetting(
    containerEl: SettingsContainer,
    name: string,
    key: "previewExportFolder" | "stagingApplyFolder" | "conflictFolder",
    folderName: string,
    description: string
  ): void {
    new Setting(containerEl)
      .setName(name)
      .setDesc(description)
      .addText((text) => {
        text
          .setPlaceholder(`${this.plugin.app.vault.configDir}/plugins/light-livesync/${folderName}`)
          .setValue(this.plugin.settings[key])
          .onChange(async (value) => {
            this.plugin.settings[key] = value.trim().replace(/^\/+|\/+$/g, "");
            await this.plugin.saveSettingsAndReschedule();
          });
      });
  }

  private renderStatusSection(containerEl: SettingsContainer): void {
    this.section(containerEl, "Sync activity");
    new Setting(containerEl)
      .setName("Sync activity")
      .setDesc(this.statusSummary());
    this.renderConnectionSummary(containerEl);
    this.renderRemoteStatus(containerEl);
    this.renderRuntimeStatus(containerEl);
    this.renderActivityLog(containerEl);
    this.renderSyncMetricsStatus(containerEl);
    this.renderQueueStatus(containerEl);
    this.renderPreviewStatus(containerEl);
    this.renderStagingStatus(containerEl);
    this.renderLiveApplyStatus(containerEl);
  }

  private statusSummary(): string {
    const settings = this.plugin.getRuntimeSettings();
    const runtime = settings.runtime;
    const queue = settings.localQueue;
    if (!settings.configured) {
      return "Not connected yet. Use Connect CouchDB or Use setup URI above.";
    }
    if (credentialsAreLocked(settings)) {
      return "Credentials are saved but this device could not open them automatically. Update saved credentials once to refresh sync.";
    }
    if (runtime.lastSyncStartedAt > 0 && runtime.lastSyncFinishedAt === 0) {
      return "Sync is running in the background.";
    }
    if (runtime.lastSyncError) {
      return `${friendlyError(runtime.lastSyncError)} Queued changes are kept for the next retry.`;
    }
    if (queue.pendingPush > 0 || queue.pendingApply > 0) {
      return `${queue.pendingPush} local change${queue.pendingPush === 1 ? "" : "s"} waiting to upload; ${queue.pendingApply} remote file${queue.pendingApply === 1 ? "" : "s"} ready to apply.`;
    }
    if (settings.remoteState.lastCheckedAt === 0) {
      return "Ready to check the server. Run one sync to verify this device.";
    }
    return "Quiet. No action needed.";
  }

  private renderConnectionSummary(containerEl: SettingsContainer): void {
    this.section(containerEl, "CouchDB connection");
    const couchDb = this.plugin.settings.couchDb;
    new Setting(containerEl)
      .setName("Server address")
      .setDesc(couchDb.uri || "Not configured yet");
    new Setting(containerEl)
      .setName("Username")
      .setDesc(couchDb.username || "Not configured yet");
    new Setting(containerEl)
      .setName("Database name")
      .setDesc(couchDb.database || "Not configured yet");
  }

  private renderRemoteStatus(containerEl: SettingsContainer): void {
    const state = this.plugin.settings.remoteState;
    new Setting(containerEl)
      .setName("Last remote check")
      .setDesc(`${formatTime(state.lastCheckedAt)}. ${state.documentCount} documents on the server. Last server sequence: ${state.updateSequence || "unknown"}. Sync parameters: ${state.syncParametersPresent ? "ready" : "not seen yet"}.`);
  }

  private renderRuntimeStatus(containerEl: SettingsContainer): void {
    const runtime = this.plugin.settings.runtime;
    const outcome = runtime.lastSyncStartedAt === 0
      ? "Not run yet"
      : runtime.lastSyncFinishedAt === 0
      ? "Running"
      : runtime.lastSyncOk
        ? "OK"
        : "Failed";
    new Setting(containerEl)
      .setName("Runtime sync")
      .setDesc(
        `${outcome}. Last reason: ${runtime.lastSyncReason || "none"}. Started: ${formatTime(runtime.lastSyncStartedAt)}. Duration: ${runtime.lastSyncDurationMs}ms. Completed: ${runtime.syncsFinished}/${runtime.syncsStarted}. Failed: ${runtime.syncsFailed}.${runtime.lastSyncError ? ` Last issue: ${friendlyError(runtime.lastSyncError)}` : ""}`
      );
  }

  private renderActivityLog(containerEl: SettingsContainer): void {
    this.section(containerEl, "Recent activity");
    const log = this.plugin.settings.runtime.activityLog ?? [];
    if (log.length === 0) {
      new Setting(containerEl)
        .setName("Activity log")
        .setDesc("No recent setup or sync messages yet.");
      return;
    }

    new Setting(containerEl)
      .setName("Activity log")
      .setDesc("Recent setup and sync messages are kept here so short popups are easier to review.")
      .addButton((button) => {
        button.setButtonText("Clear").onClick(async () => {
          await this.plugin.clearActivityLog();
          this.display();
        });
      });

    for (const entry of log.slice(0, 8)) {
      new Setting(containerEl)
        .setName(formatTime(entry.timestamp))
        .setDesc(entry.message);
    }
  }

  private renderSyncMetricsStatus(containerEl: SettingsContainer): void {
    const metrics = this.plugin.settings.runtime.lastSyncMetrics;
    new Setting(containerEl)
      .setName("Last sync workload")
      .setDesc(
        `Phases: inspect ${metrics.inspectMs}ms, push ${metrics.pushMs}ms, pull ${metrics.pullMs}ms, apply ${metrics.applyMs}ms. Uploaded ${metrics.pushedFiles} file${metrics.pushedFiles === 1 ? "" : "s"} (${formatBytes(metrics.localBytesRead)} read locally, ${metrics.chunkDocsBuilt} chunk doc${metrics.chunkDocsBuilt === 1 ? "" : "s"} built); remote docs written ${metrics.remoteDocsWritten}, reused ${metrics.remoteDocsReused}, conflicts ${metrics.remoteDocsConflicts}. Pulled ${metrics.pulledChanges} change${metrics.pulledChanges === 1 ? "" : "s"}; applied ${metrics.appliedFiles}, merged ${metrics.mergedFiles}, backups ${metrics.backedUpFiles}, unresolved conflicts ${metrics.conflictedFiles}.`
      );
  }

  private renderQueueStatus(containerEl: SettingsContainer): void {
    const queue = this.plugin.settings.localQueue;
    new Setting(containerEl)
      .setName("Local pull queue")
      .setDesc(
        `${formatTime(queue.lastPulledAt)}. Pulled files waiting locally: ${queue.files}. Pulled chunks: ${queue.chunks}. Files still to apply: ${queue.pendingApply}. Local changes still to upload: ${queue.pendingPush}.`
      );
  }

  private renderPreviewStatus(containerEl: SettingsContainer): void {
    const preview = this.plugin.settings.localPreview;
    new Setting(containerEl)
      .setName("Pull preview")
      .setDesc(
        `${formatTime(preview.lastPreviewedAt)}. Checked ${preview.checked}; ready ${preview.ready}; missing chunks ${preview.missingChunks}; waiting for credentials ${preview.encryptedUnsupported}; unsupported ${preview.unsupported}.`
      );
  }

  private renderStagingStatus(containerEl: SettingsContainer): void {
    const staging = this.plugin.settings.localStaging;
    new Setting(containerEl)
      .setName("Staging apply")
      .setDesc(`${formatTime(staging.lastStagedAt)}. Staged ${staging.staged}; skipped ${staging.skipped}; failed ${staging.failed}.`);
  }

  private renderLiveApplyStatus(containerEl: SettingsContainer): void {
    const liveApply = this.plugin.settings.localLiveApply;
    new Setting(containerEl)
      .setName("Live apply")
      .setDesc(
        `${formatTime(liveApply.lastAppliedAt)}. Applied ${liveApply.applied}; merged ${liveApply.merged}; deleted ${liveApply.deleted}; backups ${liveApply.backedUp}; unresolved conflicts ${liveApply.conflicted}; failed ${liveApply.failed}.`
      );
  }
}

function formatTime(timestamp: number): string {
  return timestamp ? new Date(timestamp).toLocaleString() : "Never";
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  const kib = bytes / 1024;
  if (kib < 1024) {
    return `${kib.toFixed(kib < 10 ? 1 : 0)} KiB`;
  }
  const mib = kib / 1024;
  return `${mib.toFixed(mib < 10 ? 1 : 0)} MiB`;
}

function friendlyError(message: string): string {
  if (/not configured/i.test(message)) {
    return "This vault is not connected yet. Use Connect CouchDB or Use setup URI to start syncing.";
  }
  if (/Credentials are locked/i.test(message)) {
    return "Saved credentials could not be opened automatically. Update saved credentials once to refresh this device.";
  }
  if (/Could not reach CouchDB|ERR_ADDRESS_UNREACHABLE|ERR_CONNECTION_REFUSED|ERR_NETWORK_ACCESS_DENIED/i.test(message)) {
    return "CouchDB could not be reached. Check local-network permission, Wi-Fi/VPN, firewall rules, and that the server is awake.";
  }
  if (/timed out/i.test(message)) {
    return "CouchDB did not answer in time. The plugin will keep queued changes and retry later.";
  }
  return message;
}
