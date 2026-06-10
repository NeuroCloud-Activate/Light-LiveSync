import assert from "node:assert/strict";
import {
  isTextSyncPath,
  shouldScanLowIntensityConfigFolder,
  shouldScanVaultFolder,
  shouldSyncVaultPath
} from "../src/vault-scan.ts";

const options = {
  configDir: ".obsidian",
  pluginId: "light-livesync",
  previewExportFolder: ".obsidian/plugins/light-livesync/preview",
  stagingApplyFolder: ".obsidian/plugins/light-livesync/staging",
  conflictFolder: ".obsidian/plugins/light-livesync/conflicts"
};

assert.equal(shouldSyncVaultPath(".obsidian/plugins/other-plugin/data.json", options), true);
assert.equal(shouldSyncVaultPath(".obsidian/plugins/other-plugin/settings.json", options), true);
assert.equal(shouldSyncVaultPath(".obsidian/plugins/other-plugin/custom-settings.json", options), true);

assert.equal(shouldSyncVaultPath("Notes/hello.md", options), true);
assert.equal(shouldSyncVaultPath("PDFs/example.pdf", options), true);
assert.equal(shouldSyncVaultPath(".obsidian/snippets/readable.css", options), true);
assert.equal(shouldSyncVaultPath(".obsidian/app.json", options), false);
assert.equal(shouldSyncVaultPath(".obsidian/appearance.json", options), false);
assert.equal(shouldSyncVaultPath(".obsidian/community-plugins.json", options), false);
assert.equal(shouldSyncVaultPath(".obsidian/hotkeys.json", options), false);
assert.equal(shouldSyncVaultPath(".obsidian/workspace-mobile.json", options), false);
assert.equal(shouldSyncVaultPath(".obsidian/plugins/light-livesync/manifest.json", options), false);
assert.equal(shouldSyncVaultPath(".obsidian/plugins/light-livesync/main.js", options), false);
assert.equal(shouldSyncVaultPath(".obsidian/plugins/light-livesync/styles.css", options), false);
assert.equal(shouldSyncVaultPath(".obsidian/plugins/other-plugin/manifest.json", options), false);
assert.equal(shouldSyncVaultPath(".obsidian/plugins/other-plugin/main.js", options), false);
assert.equal(shouldSyncVaultPath(".obsidian/plugins/other-plugin/mobile.css", options), false);
assert.equal(shouldSyncVaultPath(".obsidian/plugins/other-plugin/cache.json", options), false);
assert.equal(shouldSyncVaultPath(".obsidian/plugins/other-plugin/activity-log.json", options), false);
assert.equal(shouldSyncVaultPath(".obsidian/plugins/other-plugin/history.json", options), false);
assert.equal(shouldSyncVaultPath(".obsidian/plugins/other-plugin/nested/settings.json", options), false);
assert.equal(shouldSyncVaultPath(".obsidian/plugins/light-livesync/data.json", options), false);
assert.equal(shouldSyncVaultPath(".obsidian/plugins/light-livesync/data.json.tmp", options), false);
assert.equal(shouldSyncVaultPath(".obsidian/plugins/light-livesync/preview/file.md", options), false);
assert.equal(shouldSyncVaultPath(".obsidian/plugins/light-livesync/staging/file.md", options), false);
assert.equal(shouldSyncVaultPath(".obsidian/plugins/light-livesync/conflicts/file.md", options), false);
assert.equal(shouldSyncVaultPath(".obsidian/plugins/Light-LiveSync/Light-LiveSync-main/README.md", options), false);
assert.equal(shouldSyncVaultPath(".obsidian/plugins/Light-LiveSync/Light-LiveSync-main/.github/workflows/release.yml", options), false);
assert.equal(shouldSyncVaultPath("node_modules/example/index.js", options), false);
assert.equal(shouldSyncVaultPath(".git/config", options), false);
assert.equal(shouldSyncVaultPath(".repowise/index.json", options), false);
assert.equal(shouldSyncVaultPath(".trash/deleted.md", options), false);
assert.equal(shouldSyncVaultPath(".DS_Store", options), false);

assert.equal(shouldScanVaultFolder("", options), true);
assert.equal(shouldScanVaultFolder(".obsidian", options), true);
assert.equal(shouldScanVaultFolder(".obsidian/plugins/other-plugin", options), true);
assert.equal(shouldScanVaultFolder(".obsidian/plugins/light-livesync/preview", options), false);
assert.equal(shouldScanVaultFolder(".obsidian/plugins/Light-LiveSync/Light-LiveSync-main", options), false);
assert.equal(shouldScanVaultFolder(".obsidian/plugins/Light-LiveSync/Light-LiveSync-main/.github", options), false);
assert.equal(shouldScanVaultFolder(".trash", options), false);

assert.equal(shouldScanLowIntensityConfigFolder(".obsidian", options), true);
assert.equal(shouldScanLowIntensityConfigFolder(".obsidian/plugins", options), true);
assert.equal(shouldScanLowIntensityConfigFolder(".obsidian/plugins/other-plugin", options), true);
assert.equal(shouldScanLowIntensityConfigFolder(".obsidian/plugins/other-plugin/cache", options), false);
assert.equal(shouldScanLowIntensityConfigFolder(".obsidian/snippets", options), true);
assert.equal(shouldScanLowIntensityConfigFolder(".obsidian/themes", options), false);
assert.equal(shouldScanLowIntensityConfigFolder("Notes", options), false);

assert.equal(isTextSyncPath("Daily.md"), true);
assert.equal(isTextSyncPath("Board.canvas"), true);
assert.equal(isTextSyncPath("View.base"), true);
assert.equal(isTextSyncPath("PDFs/example.pdf"), false);
assert.equal(isTextSyncPath("image.png"), false);

console.log(JSON.stringify({
  ok: true,
  syncsVaultFiles: true,
  syncsPluginSettings: true,
  excludesRuntimeConfig: true,
  excludesOwnVolatileState: true,
  excludesPluginBundles: true,
  excludesGeneratedFolders: true,
  lowIntensityConfigScan: true,
  syncsPdfAttachments: true,
  baseFilesAreText: true
}, null, 2));
