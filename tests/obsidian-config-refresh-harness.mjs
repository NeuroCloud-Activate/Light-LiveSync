import assert from "node:assert/strict";
import {
  planObsidianConfigRefresh,
  shouldAutoApplyPluginRefresh,
  shouldDeferMobileConfigApply,
  shouldPromptForAppReload
} from "../src/obsidian-config-refresh.ts";

const plan = planObsidianConfigRefresh(
  [
    ".obsidian/community-plugins.json",
    ".obsidian/app.json",
    ".obsidian/appearance.json",
    ".obsidian/plugins/calendar/data.json",
    ".obsidian/plugins/tasks/manifest.json",
    ".obsidian/plugins/tasks/main.js",
    ".obsidian/plugins/tasks/sync-worker.js",
    ".obsidian/plugins/light-livesync/main.js",
    ".obsidian/plugins/light-livesync/data.json",
    "notes/plain.md"
  ],
  ".obsidian",
  "light-livesync"
);

assert.equal(plan.communityPluginsChanged, true);
assert.deepEqual(plan.appSettingsChanged, [".obsidian/app.json", ".obsidian/appearance.json"]);
assert.deepEqual(plan.otherConfigChanged, [".obsidian/plugins/calendar/data.json", ".obsidian/plugins/light-livesync/data.json"]);
assert.deepEqual(plan.pluginsToReload, ["tasks"]);
assert.equal(plan.ownPluginChanged, true);
assert.equal(shouldAutoApplyPluginRefresh(plan, false), false);
assert.equal(shouldAutoApplyPluginRefresh(plan, true), false);
assert.equal(shouldPromptForAppReload(plan, false), false);
assert.equal(shouldPromptForAppReload(plan, true), false);

const customConfigPlan = planObsidianConfigRefresh(
  [
    "config/community-plugins.json",
    "config/plugins/ai-helper/custom-settings.json",
    "config/plugins/ai-helper/mobile.css",
    "config/plugins/light-livesync/data.json",
    "config/hotkeys.json"
  ],
  "config",
  "light-livesync"
);

assert.equal(customConfigPlan.communityPluginsChanged, true);
assert.deepEqual(customConfigPlan.appSettingsChanged, ["config/hotkeys.json"]);
assert.deepEqual(customConfigPlan.otherConfigChanged, ["config/plugins/ai-helper/custom-settings.json", "config/plugins/light-livesync/data.json"]);
assert.deepEqual(customConfigPlan.pluginsToReload, ["ai-helper"]);
assert.equal(customConfigPlan.ownPluginChanged, false);

const settingsOnlyPlan = planObsidianConfigRefresh(
  [
    ".obsidian/plugins/calendar/data.json",
    ".obsidian/plugins/tasks/settings.json",
    ".obsidian/plugins/tasks/nested/extra.js"
  ],
  ".obsidian",
  "light-livesync"
);

assert.equal(settingsOnlyPlan.communityPluginsChanged, false);
assert.deepEqual(settingsOnlyPlan.appSettingsChanged, []);
assert.deepEqual(settingsOnlyPlan.otherConfigChanged, [
  ".obsidian/plugins/calendar/data.json",
  ".obsidian/plugins/tasks/nested/extra.js",
  ".obsidian/plugins/tasks/settings.json"
]);
assert.deepEqual(settingsOnlyPlan.pluginsToReload, []);
assert.equal(settingsOnlyPlan.ownPluginChanged, false);
assert.equal(shouldAutoApplyPluginRefresh(settingsOnlyPlan, false), false);
assert.equal(shouldPromptForAppReload(settingsOnlyPlan, true), false);

assert.equal(shouldDeferMobileConfigApply(".obsidian/app.json", ".obsidian", "light-livesync"), false);
assert.equal(shouldDeferMobileConfigApply(".obsidian/workspace-mobile.json", ".obsidian", "light-livesync"), false);
assert.equal(shouldDeferMobileConfigApply(".obsidian/community-plugins.json", ".obsidian", "light-livesync"), false);
assert.equal(shouldDeferMobileConfigApply(".obsidian/plugins/tasks/main.js", ".obsidian", "light-livesync"), false);
assert.equal(shouldDeferMobileConfigApply(".obsidian/plugins/calendar/data.json", ".obsidian", "light-livesync"), false);
assert.equal(shouldDeferMobileConfigApply(".obsidian/plugins/calendar/nested/cache.json", ".obsidian", "light-livesync"), false);
assert.equal(shouldDeferMobileConfigApply("notes/plain.md", ".obsidian", "light-livesync"), false);

console.log(JSON.stringify({
  ok: true,
  communityPluginsChanged: plan.communityPluginsChanged,
  pluginsToReload: plan.pluginsToReload,
  appSettingsChanged: plan.appSettingsChanged,
  otherConfigChanged: plan.otherConfigChanged,
  ownPluginChanged: plan.ownPluginChanged,
  settingsOnlyDoesNotReload: settingsOnlyPlan.pluginsToReload.length === 0 && settingsOnlyPlan.otherConfigChanged.length > 0,
  mobileAppSettingsDeferred: shouldDeferMobileConfigApply(".obsidian/app.json", ".obsidian", "light-livesync"),
  automaticPluginReloadDisabled: !shouldAutoApplyPluginRefresh(plan, false) && !shouldAutoApplyPluginRefresh(plan, true),
  reloadPromptShown: shouldPromptForAppReload(plan, true)
}, null, 2));
