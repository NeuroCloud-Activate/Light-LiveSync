import assert from "node:assert/strict";
import { planObsidianConfigRefresh } from "../src/obsidian-config-refresh.ts";

const plan = planObsidianConfigRefresh(
  [
    ".obsidian/community-plugins.json",
    ".obsidian/app.json",
    ".obsidian/appearance.json",
    ".obsidian/plugins/calendar/data.json",
    ".obsidian/plugins/tasks/manifest.json",
    ".obsidian/plugins/tasks/main.js",
    ".obsidian/plugins/light-livesync/main.js",
    "notes/plain.md"
  ],
  ".obsidian",
  "light-livesync"
);

assert.equal(plan.communityPluginsChanged, true);
assert.deepEqual(plan.appSettingsChanged, [".obsidian/app.json", ".obsidian/appearance.json"]);
assert.deepEqual(plan.pluginsToReload, ["calendar", "tasks"]);
assert.equal(plan.ownPluginChanged, true);

const customConfigPlan = planObsidianConfigRefresh(
  [
    "config/community-plugins.json",
    "config/plugins/ai-helper/custom-settings.json",
    "config/plugins/light-livesync/data.json",
    "config/hotkeys.json"
  ],
  "config",
  "light-livesync"
);

assert.equal(customConfigPlan.communityPluginsChanged, true);
assert.deepEqual(customConfigPlan.appSettingsChanged, ["config/hotkeys.json"]);
assert.deepEqual(customConfigPlan.pluginsToReload, ["ai-helper"]);
assert.equal(customConfigPlan.ownPluginChanged, true);

console.log(JSON.stringify({
  ok: true,
  communityPluginsChanged: plan.communityPluginsChanged,
  pluginsToReload: plan.pluginsToReload,
  appSettingsChanged: plan.appSettingsChanged,
  ownPluginChanged: plan.ownPluginChanged
}, null, 2));
