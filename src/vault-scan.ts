export type VaultSyncPathOptions = {
  configDir: string;
  pluginId: string;
  previewExportFolder: string;
  stagingApplyFolder: string;
  conflictFolder: string;
};

const TEXT_EXTENSIONS = new Set([
  "base",
  "canvas",
  "css",
  "csv",
  "html",
  "js",
  "json",
  "md",
  "txt",
  "ts",
  "xml",
  "yaml",
  "yml"
]);

const JUNK_FILENAMES = new Set([
  ".DS_Store",
  "Thumbs.db",
  "desktop.ini"
]);

const LOCAL_ONLY_FOLDER_NAMES = new Set([
  ".git",
  ".github",
  ".repowise",
  "node_modules",
  "light-livesync-main"
]);

const TOP_LEVEL_RUNTIME_CONFIG_FILES = new Set([
  "app.json",
  "appearance.json",
  "community-plugins.json",
  "core-plugins.json",
  "core-plugins-migration.json",
  "graph.json",
  "hotkeys.json",
  "types.json"
]);

const NOISY_CONFIG_FILE_PATTERNS = [
  /(^|[-_.])cache(s)?([-_.]|$)/i,
  /(^|[-_.])log(s)?([-_.]|$)/i,
  /(^|[-_.])history([-_.]|$)/i,
  /(^|[-_.])state([-_.]|$)/i,
  /(^|[-_.])tmp([-_.]|$)/i,
  /(^|[-_.])temp([-_.]|$)/i,
  /(^|[-_.])backup(s)?([-_.]|$)/i
];

function cleanPath(path: string): string {
  return path.trim().replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");
}

function pathInside(path: string, folder: string): boolean {
  const cleanedFolder = cleanPath(folder);
  const lowerPath = cleanPath(path).toLowerCase();
  const lowerFolder = cleanedFolder.toLowerCase();
  return !!lowerFolder && (lowerPath === lowerFolder || lowerPath.startsWith(`${lowerFolder}/`));
}

function hasLocalOnlyFolderSegment(path: string): boolean {
  return cleanPath(path)
    .split("/")
    .some((part) => LOCAL_ONLY_FOLDER_NAMES.has(part.toLowerCase()));
}

function extensionOf(path: string): string {
  const name = path.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

function isPluginBundleAsset(path: string, configDir: string): boolean {
  const cleaned = cleanPath(path);
  const pluginsDir = `${cleanPath(configDir)}/plugins`;
  if (!cleaned.startsWith(`${pluginsDir}/`)) {
    return false;
  }
  const rest = cleaned.slice(`${pluginsDir}/`.length);
  const [, ...parts] = rest.split("/");
  const pluginPath = parts.join("/");
  if (!pluginPath || pluginPath.includes("/")) {
    return false;
  }
  return pluginPath === "manifest.json" ||
    pluginPath.endsWith(".js") ||
    pluginPath.endsWith(".css");
}

function isRuntimeObsidianConfigFile(path: string, configDir: string): boolean {
  const cleaned = cleanPath(path);
  const normalizedConfigDir = cleanPath(configDir);
  if (!normalizedConfigDir || !cleaned.startsWith(`${normalizedConfigDir}/`)) {
    return false;
  }

  const relativePath = cleaned.slice(`${normalizedConfigDir}/`.length);
  if (!relativePath || relativePath.includes("/")) {
    return false;
  }

  const lowerPath = relativePath.toLowerCase();
  return TOP_LEVEL_RUNTIME_CONFIG_FILES.has(lowerPath) ||
    /^workspace.*\.json$/i.test(relativePath);
}

function isUserConfigurableObsidianSettingFile(path: string, options: VaultSyncPathOptions): boolean {
  const cleaned = cleanPath(path);
  const normalizedConfigDir = cleanPath(options.configDir);
  if (!normalizedConfigDir || !cleaned.startsWith(`${normalizedConfigDir}/`)) {
    return true;
  }
  if (isRuntimeObsidianConfigFile(cleaned, normalizedConfigDir)) {
    return false;
  }

  const relativeConfigPath = cleaned.slice(`${normalizedConfigDir}/`.length);
  const configParts = relativeConfigPath.split("/");
  const configFilename = configParts.at(-1) ?? "";
  if (configParts[0]?.toLowerCase() === "snippets") {
    return configParts.length === 2 &&
      configFilename.toLowerCase().endsWith(".css") &&
      !NOISY_CONFIG_FILE_PATTERNS.some((pattern) => pattern.test(configFilename));
  }

  const pluginsDir = `${normalizedConfigDir}/plugins`;
  if (!cleaned.startsWith(`${pluginsDir}/`)) {
    return false;
  }

  const relativePath = cleaned.slice(`${pluginsDir}/`.length);
  const parts = relativePath.split("/");
  const filename = parts.at(-1) ?? "";
  const pluginId = parts[0] ?? "";
  if (!pluginId || pluginId.toLowerCase() === cleanPath(options.pluginId).toLowerCase()) {
    return false;
  }
  if (
    parts.length !== 2 ||
    !filename.toLowerCase().endsWith(".json") ||
    NOISY_CONFIG_FILE_PATTERNS.some((pattern) => pattern.test(filename))
  ) {
    return false;
  }

  return true;
}

function localOnlyFolders(options: VaultSyncPathOptions): string[] {
  const pluginDir = `${cleanPath(options.configDir)}/plugins/${options.pluginId}`;
  return [
    options.previewExportFolder,
    options.stagingApplyFolder,
    options.conflictFolder,
    `${pluginDir}/preview`,
    `${pluginDir}/staging`,
    `${pluginDir}/conflicts`
  ].map(cleanPath).filter(Boolean);
}

export function isTextSyncPath(path: string): boolean {
  return TEXT_EXTENSIONS.has(extensionOf(path));
}

export function shouldScanVaultFolder(path: string, options: VaultSyncPathOptions): boolean {
  const cleaned = cleanPath(path);
  if (!cleaned) {
    return true;
  }
  if (cleaned === ".trash" || cleaned.startsWith(".trash/")) {
    return false;
  }
  if (hasLocalOnlyFolderSegment(cleaned)) {
    return false;
  }
  return !localOnlyFolders(options).some((folder) => pathInside(cleaned, folder));
}

export function shouldScanLowIntensityConfigFolder(path: string, options: VaultSyncPathOptions): boolean {
  const cleaned = cleanPath(path);
  const configDir = cleanPath(options.configDir);
  if (!configDir || !shouldScanVaultFolder(cleaned, options)) {
    return false;
  }
  if (cleaned === configDir) {
    return true;
  }

  const relativePath = cleaned.startsWith(`${configDir}/`) ? cleaned.slice(`${configDir}/`.length) : "";
  if (!relativePath) {
    return false;
  }

  const parts = relativePath.split("/");
  if (parts.length === 1) {
    return parts[0].toLowerCase() === "plugins" || parts[0].toLowerCase() === "snippets";
  }

  if (parts[0].toLowerCase() === "plugins") {
    return parts.length === 2;
  }

  return false;
}

export function shouldSyncVaultPath(path: string, options: VaultSyncPathOptions): boolean {
  const cleaned = cleanPath(path);
  if (!cleaned) {
    return false;
  }

  const filename = cleaned.split("/").pop() ?? "";
  if (JUNK_FILENAMES.has(filename)) {
    return false;
  }
  if (!shouldScanVaultFolder(cleaned.split("/").slice(0, -1).join("/"), options)) {
    return false;
  }
  if (!isUserConfigurableObsidianSettingFile(cleaned, options)) {
    return false;
  }
  if (isPluginBundleAsset(cleaned, options.configDir)) {
    return false;
  }

  const pluginDir = `${cleanPath(options.configDir)}/plugins/${options.pluginId}`;
  if (cleaned === `${pluginDir}/data.json`) {
    return false;
  }
  if (cleaned.startsWith(`${pluginDir}/data.json.`)) {
    return false;
  }

  return true;
}
