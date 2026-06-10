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

function isUserConfigurableObsidianSettingFile(path: string, options: VaultSyncPathOptions): boolean {
  const cleaned = cleanPath(path);
  const normalizedConfigDir = cleanPath(options.configDir);
  if (!normalizedConfigDir || !cleaned.startsWith(`${normalizedConfigDir}/`)) {
    return true;
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
  const configDir = cleanPath(options.configDir);
  if (configDir && (cleaned === configDir || cleaned.startsWith(`${configDir}/`))) {
    const pluginsDir = `${configDir}/plugins`;
    if (cleaned === configDir || cleaned === pluginsDir) {
      return true;
    }
    if (!cleaned.startsWith(`${pluginsDir}/`)) {
      return false;
    }
    const relativePath = cleaned.slice(`${pluginsDir}/`.length);
    const parts = relativePath.split("/").filter(Boolean);
    if (parts.length !== 1) {
      return false;
    }
    const pluginId = parts[0] ?? "";
    return !!pluginId && pluginId.toLowerCase() !== cleanPath(options.pluginId).toLowerCase();
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

  const pluginsDir = `${configDir}/plugins`;
  if (cleaned === pluginsDir) {
    return true;
  }
  if (!cleaned.startsWith(`${pluginsDir}/`)) {
    return false;
  }

  const relativePath = cleaned.slice(`${pluginsDir}/`.length);
  return relativePath.split("/").filter(Boolean).length === 1;
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

export function shouldApplyRemoteVaultPath(path: string, options: VaultSyncPathOptions): boolean {
  return shouldSyncVaultPath(path, options);
}
