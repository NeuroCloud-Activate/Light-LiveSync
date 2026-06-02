import type { DataAdapter } from "obsidian";
import { isTextSyncPath } from "./vault-scan";

export type RecoveryBackupEntry = {
  backupPath: string;
  originalPath: string;
  size: number;
  modifiedAt: number;
};

export type RecoveryRestoreResult = {
  restoredPath: string;
  createdPreRestoreBackup: boolean;
  preRestoreBackupPath: string;
};

const BACKUP_SUFFIX_PATTERN = /\.local-conflict-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

function normalizeVaultPath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean)
    .join("/");
}

function folderOf(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

async function ensureFolder(adapter: DataAdapter, folderPath: string): Promise<void> {
  const parts = normalizeVaultPath(folderPath).split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!(await adapter.exists(current))) {
      await adapter.mkdir(current);
    }
  }
}

async function collectFiles(adapter: DataAdapter, folder: string, files: string[]): Promise<void> {
  let listing: { files: string[]; folders: string[] };
  try {
    listing = await adapter.list(folder);
  } catch {
    return;
  }

  files.push(...listing.files.map(normalizeVaultPath));
  for (const childFolder of listing.folders) {
    await collectFiles(adapter, normalizeVaultPath(childFolder), files);
  }
}

export function inferOriginalPathFromRecoveryBackup(conflictFolder: string, backupPath: string): string | undefined {
  const folder = normalizeVaultPath(conflictFolder);
  const path = normalizeVaultPath(backupPath);
  const prefix = `${folder}/`;
  if (!folder || !path.startsWith(prefix) || !BACKUP_SUFFIX_PATTERN.test(path)) {
    return undefined;
  }

  const relative = path.slice(prefix.length);
  const parts = relative.split("/");
  const name = parts.pop();
  if (!name) {
    return undefined;
  }

  const originalName = name.replace(BACKUP_SUFFIX_PATTERN, "");
  return normalizeVaultPath([...parts, originalName].join("/"));
}

export async function listRecoveryBackups(
  adapter: DataAdapter,
  conflictFolder: string,
  limit = 25
): Promise<RecoveryBackupEntry[]> {
  const folder = normalizeVaultPath(conflictFolder);
  if (!folder || !(await adapter.exists(folder))) {
    return [];
  }

  const files: string[] = [];
  await collectFiles(adapter, folder, files);

  const entries: RecoveryBackupEntry[] = [];
  for (const backupPath of files) {
    const originalPath = inferOriginalPathFromRecoveryBackup(folder, backupPath);
    if (!originalPath) {
      continue;
    }
    const fileStat = await adapter.stat(backupPath);
    entries.push({
      backupPath,
      originalPath,
      size: fileStat?.size ?? 0,
      modifiedAt: fileStat?.mtime ?? 0
    });
  }

  return entries
    .sort((left, right) => right.modifiedAt - left.modifiedAt || left.backupPath.localeCompare(right.backupPath))
    .slice(0, Math.max(1, limit));
}

function nextRecoveryBackupPath(conflictFolder: string, originalPath: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const normalizedOriginal = normalizeVaultPath(originalPath);
  const folder = folderOf(normalizedOriginal);
  const name = normalizedOriginal.split("/").pop() ?? "untitled.md";
  return normalizeVaultPath(`${conflictFolder}/${folder ? `${folder}/` : ""}${name}.local-conflict-${timestamp}`);
}

export async function restoreRecoveryBackup(
  adapter: DataAdapter,
  entry: Pick<RecoveryBackupEntry, "backupPath" | "originalPath">,
  conflictFolder: string
): Promise<RecoveryRestoreResult> {
  const originalPath = normalizeVaultPath(entry.originalPath);
  const backupPath = normalizeVaultPath(entry.backupPath);
  const preRestoreBackupPath = nextRecoveryBackupPath(conflictFolder, originalPath);
  const restoreAsText = isTextSyncPath(originalPath);
  let createdPreRestoreBackup = false;

  if (await adapter.exists(originalPath)) {
    await ensureFolder(adapter, folderOf(preRestoreBackupPath));
    if (restoreAsText) {
      await adapter.write(preRestoreBackupPath, await adapter.read(originalPath));
    } else {
      await adapter.writeBinary(preRestoreBackupPath, await adapter.readBinary(originalPath));
    }
    createdPreRestoreBackup = true;
  }

  await ensureFolder(adapter, folderOf(originalPath));
  if (restoreAsText) {
    await adapter.write(originalPath, await adapter.read(backupPath));
  } else {
    await adapter.writeBinary(originalPath, await adapter.readBinary(backupPath));
  }

  return {
    restoredPath: originalPath,
    createdPreRestoreBackup,
    preRestoreBackupPath: createdPreRestoreBackup ? preRestoreBackupPath : ""
  };
}
