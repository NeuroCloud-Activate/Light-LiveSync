import type { DataAdapter } from "obsidian";
import type { ReconstructedDocumentPreview } from "./document-reconstructor";
import { automaticTextMerge } from "./text-merge";

export type LiveVaultApplyResult = {
  applied: number;
  deleted: number;
  skipped: number;
  merged: number;
  backedUp: number;
  conflicted: number;
  failed: number;
  appliedIds: string[];
  conflictFolder: string;
};

type MutableLiveVaultApplyResult = LiveVaultApplyResult;
type VaultFile = unknown;
type LiveVaultApplyOptions = {
  configDir: string;
  conflictFolder: string;
  yieldToUi?(): Promise<void>;
};

export type LiveVaultTarget = {
  adapter: DataAdapter;
  getAbstractFileByPath(path: string): VaultFile | null;
  read(file: VaultFile): Promise<string>;
  readBinary(file: VaultFile): Promise<ArrayBuffer>;
  create(path: string, data: string): Promise<VaultFile>;
  createBinary(path: string, data: ArrayBuffer): Promise<VaultFile>;
  modify(file: VaultFile, data: string): Promise<void>;
  modifyBinary(file: VaultFile, data: ArrayBuffer): Promise<void>;
  delete(file: VaultFile): Promise<void>;
};

function cleanPathPart(part: string): string {
  return part
    .replace(/\\/g, "/")
    .replace(/[:*?"<>|#\u0000-\u001f]/g, "_")
    .replace(/^\.+$/, "_")
    .trim()
    .slice(0, 160);
}

function safeVaultPath(sourcePath: string): string {
  const path = sourcePath
    .split("/")
    .map((part) => cleanPathPart(part))
    .filter(Boolean)
    .join("/");
  return path || "untitled.md";
}

function conflictPath(conflictFolder: string, sourcePath: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safe = safeVaultPath(sourcePath);
  const parts = safe.split("/");
  const name = parts.pop() ?? "untitled.md";
  const folder = parts.join("/");
  const targetName = `${name}.local-conflict-${timestamp}`;
  return `${conflictFolder.replace(/\/+$/, "")}/${folder ? `${folder}/` : ""}${targetName}`;
}

function folderOf(path: string): string {
  return path.split("/").slice(0, -1).join("/");
}

function isProtectedTarget(path: string, configDir: string): boolean {
  return path === configDir || path.startsWith(".trash/");
}

async function ensureFolder(adapter: DataAdapter, folderPath: string): Promise<void> {
  const parts = folderPath.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!(await adapter.exists(current))) {
      await adapter.mkdir(current);
    }
  }
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return value instanceof ArrayBuffer;
}

function buffersEqual(left: ArrayBuffer, right: ArrayBuffer): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  const leftBytes = new Uint8Array(left);
  const rightBytes = new Uint8Array(right);
  for (let index = 0; index < leftBytes.length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) {
      return false;
    }
  }
  return true;
}

async function readExisting(vault: LiveVaultTarget, path: string, asBinary: boolean): Promise<string | ArrayBuffer> {
  const file = vault.getAbstractFileByPath(path);
  if (!file) {
    throw new Error(`Missing vault file: ${path}`);
  }
  if (asBinary) {
    return vault.readBinary(file);
  }
  return vault.read(file);
}

async function writeContent(vault: LiveVaultTarget, path: string, content: string | ArrayBuffer): Promise<void> {
  const existing = vault.getAbstractFileByPath(path);
  if (isArrayBuffer(content)) {
    if (existing) {
      await vault.modifyBinary(existing, content);
    } else {
      await vault.createBinary(path, content);
    }
    return;
  }
  if (existing) {
    await vault.modify(existing, content);
  } else {
    await vault.create(path, content);
  }
}

function hasWritableContent(preview: ReconstructedDocumentPreview): preview is ReconstructedDocumentPreview & {
  content: string | ArrayBuffer;
} {
  return typeof preview.content === "string" || isArrayBuffer(preview.content);
}

function contentsEqual(current: string | ArrayBuffer, incoming: string | ArrayBuffer): boolean {
  if (typeof current === "string" && typeof incoming === "string") {
    return current === incoming;
  }
  return isArrayBuffer(current) && isArrayBuffer(incoming) && buffersEqual(current, incoming);
}

async function ensureParentFolder(adapter: DataAdapter, path: string): Promise<void> {
  const folder = folderOf(path);
  if (folder) {
    await ensureFolder(adapter, folder);
  }
}

async function backupExistingContent(
  vault: LiveVaultTarget,
  targetPath: string,
  conflictFolder: string,
  asBinary: boolean
): Promise<string | ArrayBuffer> {
  const current = await readExisting(vault, targetPath, asBinary);
  const localConflictPath = conflictPath(conflictFolder, targetPath);
  await ensureParentFolder(vault.adapter, localConflictPath);
  await writeContent(vault, localConflictPath, current);
  return current;
}

async function applyDeletedPreview(
  vault: LiveVaultTarget,
  preview: ReconstructedDocumentPreview,
  targetPath: string,
  result: MutableLiveVaultApplyResult
): Promise<void> {
  const existing = vault.getAbstractFileByPath(targetPath);
  if (existing) {
    await backupExistingContent(vault, targetPath, result.conflictFolder, preview.contentType === "binary");
    await vault.delete(existing);
    result.backedUp++;
  }
  result.deleted++;
  result.appliedIds.push(preview.id);
}

async function applyReadyPreview(
  vault: LiveVaultTarget,
  preview: ReconstructedDocumentPreview,
  targetPath: string,
  result: MutableLiveVaultApplyResult
): Promise<void> {
  if (!hasWritableContent(preview)) {
    result.skipped++;
    return;
  }

  if (vault.getAbstractFileByPath(targetPath)) {
    const current = await readExisting(vault, targetPath, preview.contentType === "binary");
    if (contentsEqual(current, preview.content)) {
      result.applied++;
      result.appliedIds.push(preview.id);
      return;
    }
    if (typeof current === "string" && typeof preview.content === "string") {
      const merged = automaticTextMerge(current, preview.content);
      if (merged !== current) {
        await backupExistingContent(vault, targetPath, result.conflictFolder, false);
        await writeContent(vault, targetPath, merged);
        result.backedUp++;
      }
      result.merged++;
      result.appliedIds.push(preview.id);
      return;
    }
    await backupExistingContent(vault, targetPath, result.conflictFolder, preview.contentType === "binary");
    result.backedUp++;
  }

  await writeContent(vault, targetPath, preview.content);
  result.applied++;
  result.appliedIds.push(preview.id);
}

async function applyPreview(
  vault: LiveVaultTarget,
  preview: ReconstructedDocumentPreview,
  options: Pick<LiveVaultApplyOptions, "configDir">,
  result: MutableLiveVaultApplyResult
): Promise<void> {
  if (preview.status !== "ready" && preview.status !== "deleted") {
    result.skipped++;
    return;
  }

  const targetPath = safeVaultPath(preview.path);
  if (isProtectedTarget(targetPath, options.configDir)) {
    result.skipped++;
    return;
  }

  await ensureParentFolder(vault.adapter, targetPath);
  if (preview.status === "deleted") {
    await applyDeletedPreview(vault, preview, targetPath, result);
    return;
  }
  await applyReadyPreview(vault, preview, targetPath, result);
}

export async function applyReadyPreviewsToLiveVault(
  vault: LiveVaultTarget,
  previews: ReconstructedDocumentPreview[],
  options: LiveVaultApplyOptions
): Promise<LiveVaultApplyResult> {
  await ensureFolder(vault.adapter, options.conflictFolder);
  const result: MutableLiveVaultApplyResult = {
    applied: 0,
    deleted: 0,
    skipped: 0,
    merged: 0,
    backedUp: 0,
    conflicted: 0,
    failed: 0,
    appliedIds: [],
    conflictFolder: options.conflictFolder
  };

  for (const preview of previews) {
    try {
      await options.yieldToUi?.();
      await applyPreview(vault, preview, options, result);
      await options.yieldToUi?.();
    } catch {
      result.failed++;
    }
  }

  return result;
}
