export type ObsidianConfigRefreshPlan = {
  communityPluginsChanged: boolean;
  appSettingsChanged: string[];
  otherConfigChanged: string[];
  pluginsToReload: string[];
  ownPluginChanged: boolean;
};

function normalizePathPart(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function isReloadablePluginAsset(pluginPath: string): boolean {
  if (pluginPath.includes("/")) {
    return false;
  }
  return pluginPath === "manifest.json" ||
    pluginPath.endsWith(".js") ||
    pluginPath.endsWith(".css");
}

export function shouldDeferMobileConfigApply(
  path: string,
  configDir: string,
  _ownPluginId: string
): boolean {
  const normalizedConfigDir = normalizePathPart(configDir);
  const normalizedPath = normalizePathPart(path);
  return !!normalizedConfigDir &&
    (normalizedPath === normalizedConfigDir || normalizedPath.startsWith(`${normalizedConfigDir}/`));
}

export function planObsidianConfigRefresh(
  changedPaths: string[],
  configDir: string,
  ownPluginId: string
): ObsidianConfigRefreshPlan {
  const normalizedConfigDir = normalizePathPart(configDir);
  if (!normalizedConfigDir) {
    return {
      communityPluginsChanged: false,
      appSettingsChanged: [],
      otherConfigChanged: [],
      pluginsToReload: [],
      ownPluginChanged: false
    };
  }
  const pluginsFolder = `${normalizedConfigDir}/plugins`;
  const pluginsToReload = new Set<string>();
  const appSettingsChanged = new Set<string>();
  const otherConfigChanged = new Set<string>();
  let communityPluginsChanged = false;
  let ownPluginChanged = false;

  for (const path of changedPaths.map(normalizePathPart).filter(Boolean)) {
    if (path === `${normalizedConfigDir}/community-plugins.json`) {
      communityPluginsChanged = true;
      continue;
    }

    if (!path.startsWith(`${normalizedConfigDir}/`)) {
      continue;
    }

    if (path.startsWith(`${pluginsFolder}/`)) {
      const rest = path.slice(`${pluginsFolder}/`.length);
      const [pluginId, ...parts] = rest.split("/");
      const pluginPath = parts.join("/");
      if (!pluginId || !pluginPath) {
        continue;
      }
      if (pluginId === ownPluginId) {
        ownPluginChanged = isReloadablePluginAsset(pluginPath) || ownPluginChanged;
        if (!isReloadablePluginAsset(pluginPath)) {
          otherConfigChanged.add(path);
        }
        continue;
      }
      if (isReloadablePluginAsset(pluginPath)) {
        pluginsToReload.add(pluginId);
      } else {
        otherConfigChanged.add(path);
      }
      continue;
    }

    if (path.endsWith(".json")) {
      appSettingsChanged.add(path);
    } else {
      otherConfigChanged.add(path);
    }
  }

  return {
    communityPluginsChanged,
    appSettingsChanged: uniqueSorted(appSettingsChanged),
    otherConfigChanged: uniqueSorted(otherConfigChanged),
    pluginsToReload: uniqueSorted(pluginsToReload),
    ownPluginChanged
  };
}

export function shouldAutoApplyPluginRefresh(plan: ObsidianConfigRefreshPlan, isMobile: boolean): boolean {
  if (isMobile) {
    return false;
  }
  return plan.communityPluginsChanged || plan.pluginsToReload.length > 0;
}

export function shouldPromptForAppReload(plan: ObsidianConfigRefreshPlan, isMobile: boolean): boolean {
  return plan.ownPluginChanged || (isMobile && (plan.communityPluginsChanged || plan.pluginsToReload.length > 0));
}
