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

  const pluginDir = `${cleanPath(options.configDir)}/plugins/${options.pluginId}`;
  if (cleaned === `${pluginDir}/data.json`) {
    return false;
  }
  if (cleaned.startsWith(`${pluginDir}/data.json.`)) {
    return false;
  }

  return true;
}
