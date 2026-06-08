export type ObsidianConfigRefreshPlan = {
  communityPluginsChanged: boolean;
  appSettingsChanged: string[];
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
      pluginsToReload: [],
      ownPluginChanged: false
    };
  }
  const pluginsFolder = `${normalizedConfigDir}/plugins`;
  const pluginsToReload = new Set<string>();
  const appSettingsChanged = new Set<string>();
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
        continue;
      }
      if (isReloadablePluginAsset(pluginPath)) {
        pluginsToReload.add(pluginId);
      }
      continue;
    }

    if (path.endsWith(".json")) {
      appSettingsChanged.add(path);
    }
  }

  return {
    communityPluginsChanged,
    appSettingsChanged: uniqueSorted(appSettingsChanged),
    pluginsToReload: uniqueSorted(pluginsToReload),
    ownPluginChanged
  };
}
