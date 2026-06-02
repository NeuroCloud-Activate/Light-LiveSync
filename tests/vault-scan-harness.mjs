import assert from "node:assert/strict";
import {
  isTextSyncPath,
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

assert.equal(shouldSyncVaultPath("Notes/hello.md", options), true);
assert.equal(shouldSyncVaultPath(".obsidian/app.json", options), true);
assert.equal(shouldSyncVaultPath(".obsidian/community-plugins.json", options), true);
assert.equal(shouldSyncVaultPath(".obsidian/plugins/other-plugin/data.json", options), true);
assert.equal(shouldSyncVaultPath(".obsidian/plugins/light-livesync/manifest.json", options), true);
assert.equal(shouldSyncVaultPath(".obsidian/plugins/light-livesync/main.js", options), true);

assert.equal(shouldSyncVaultPath(".obsidian/plugins/light-livesync/data.json", options), false);
assert.equal(shouldSyncVaultPath(".obsidian/plugins/light-livesync/data.json.tmp", options), false);
assert.equal(shouldSyncVaultPath(".obsidian/plugins/light-livesync/preview/file.md", options), false);
assert.equal(shouldSyncVaultPath(".obsidian/plugins/light-livesync/staging/file.md", options), false);
assert.equal(shouldSyncVaultPath(".obsidian/plugins/light-livesync/conflicts/file.md", options), false);
assert.equal(shouldSyncVaultPath(".trash/deleted.md", options), false);
assert.equal(shouldSyncVaultPath(".DS_Store", options), false);

assert.equal(shouldScanVaultFolder("", options), true);
assert.equal(shouldScanVaultFolder(".obsidian", options), true);
assert.equal(shouldScanVaultFolder(".obsidian/plugins/other-plugin", options), true);
assert.equal(shouldScanVaultFolder(".obsidian/plugins/light-livesync/preview", options), false);
assert.equal(shouldScanVaultFolder(".trash", options), false);

assert.equal(isTextSyncPath("Daily.md"), true);
assert.equal(isTextSyncPath("Board.canvas"), true);
assert.equal(isTextSyncPath("View.base"), true);
assert.equal(isTextSyncPath("image.png"), false);

console.log(JSON.stringify({
  ok: true,
  syncsVaultConfig: true,
  excludesOwnVolatileState: true,
  excludesGeneratedFolders: true,
  baseFilesAreText: true
}, null, 2));
