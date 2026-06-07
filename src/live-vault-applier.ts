import type { DataAdapter } from "obsidian";
import type { ReconstructedDocumentPreview } from "./document-reconstructor";
import { automaticTextMerge } from "./text-merge";

export type LiveVaultApplyResult = {
  applied: number;
  deleted: number;
  skipped: number;
  waiting: number;
  merged: number;
  backedUp: number;
  conflicted: number;
  failed: number;
  appliedIds: string[];
  skippedIds: string[];
  changedPaths: string[];
  waitingReasons: string[];
  skippedReasons: string[];
  failedReasons: string[];
  preservedLocalSettingsPaths: string[];
  conflictFolder: string;
};

type MutableLiveVaultApplyResult = LiveVaultApplyResult;
type VaultFile = unknown;
type LiveVaultApplyOptions = {
  configDir: string;
  conflictFolder: string;
  shouldApplyPath?(path: string): boolean;
  yieldToUi?(): Promise<void>;
};

type JsonSettingsMergeResult = {
  content: string;
  preservedLocalValues: boolean;
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

function recordReason(list: string[], path: string, reason: string): void {
  if (list.length < 10) {
    list.push(`${path}: ${reason}`);
  }
}

function recordChangedPath(result: MutableLiveVaultApplyResult, path: string): void {
  if (!result.changedPaths.includes(path)) {
    result.changedPaths.push(path);
  }
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
  if (file) {
    return asBinary ? vault.readBinary(file) : vault.read(file);
  }
  if (!(await vault.adapter.exists(path))) {
    throw new Error(`Missing vault file: ${path}`);
  }
  return asBinary ? vault.adapter.readBinary(path) : vault.adapter.read(path);
}

async function writeContent(vault: LiveVaultTarget, path: string, content: string | ArrayBuffer): Promise<void> {
  const existing = vault.getAbstractFileByPath(path);
  if (isArrayBuffer(content)) {
    if (existing) {
      await vault.modifyBinary(existing, content);
    } else if (await vault.adapter.exists(path)) {
      await vault.adapter.writeBinary(path, content);
    } else {
      await vault.createBinary(path, content);
    }
    return;
  }
  if (existing) {
    await vault.modify(existing, content);
  } else if (await vault.adapter.exists(path)) {
    await vault.adapter.write(path, content);
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isEmptySyncValue(value: unknown): boolean {
  return value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0);
}

function isProtectedSettingsKey(key: string): boolean {
  return /api[-_ ]?key|token|secret|password|passphrase|credential|auth|bearer|access[-_ ]?key|refresh[-_ ]?token|command/i.test(key);
}

function shouldUseJsonSettingsMerge(path: string, configDir: string): boolean {
  const normalizedConfigDir = configDir.replace(/\/+$/, "");
  const normalizedPath = path.replace(/\\/g, "/");
  return normalizedPath.startsWith(`${normalizedConfigDir}/`) && normalizedPath.endsWith(".json");
}

function mergeJsonSettingsValue(current: unknown, incoming: unknown, keyPath: string[] = []): { value: unknown; preservedLocalValues: boolean } {
  const key = keyPath.at(-1) ?? "";
  if (isProtectedSettingsKey(key) && !isEmptySyncValue(current) && isEmptySyncValue(incoming)) {
    return { value: current, preservedLocalValues: true };
  }

  if (isPlainObject(current) && isPlainObject(incoming)) {
    const merged: Record<string, unknown> = { ...current };
    let preservedLocalValues = false;
    for (const [childKey, incomingValue] of Object.entries(incoming)) {
      if (Object.prototype.hasOwnProperty.call(current, childKey)) {
        const child = mergeJsonSettingsValue(current[childKey], incomingValue, [...keyPath, childKey]);
        merged[childKey] = child.value;
        preservedLocalValues = preservedLocalValues || child.preservedLocalValues;
      } else {
        merged[childKey] = incomingValue;
      }
    }
    return { value: merged, preservedLocalValues };
  }

  if (Array.isArray(current) && Array.isArray(incoming) && current.length > 0 && incoming.length === 0 && isProtectedSettingsKey(key)) {
    return { value: current, preservedLocalValues: true };
  }

  return { value: incoming, preservedLocalValues: false };
}

function maybeMergeJsonSettings(path: string, configDir: string, current: string, incoming: string): JsonSettingsMergeResult | undefined {
  if (!shouldUseJsonSettingsMerge(path, configDir)) {
    return undefined;
  }
  try {
    const currentJson = JSON.parse(current) as unknown;
    const incomingJson = JSON.parse(incoming) as unknown;
    const merged = mergeJsonSettingsValue(currentJson, incomingJson);
    return {
      content: `${JSON.stringify(merged.value, null, 2)}\n`,
      preservedLocalValues: merged.preservedLocalValues
    };
  } catch {
    return undefined;
  }
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
    recordChangedPath(result, targetPath);
  } else if (await vault.adapter.exists(targetPath)) {
    await backupExistingContent(vault, targetPath, result.conflictFolder, preview.contentType === "binary");
    await vault.adapter.remove(targetPath);
    result.backedUp++;
    recordChangedPath(result, targetPath);
  }
  result.deleted++;
  result.appliedIds.push(preview.id);
}

async function applyReadyPreview(
  vault: LiveVaultTarget,
  preview: ReconstructedDocumentPreview,
  targetPath: string,
  configDir: string,
  result: MutableLiveVaultApplyResult
): Promise<void> {
  if (!hasWritableContent(preview)) {
    result.skipped++;
    result.skippedIds.push(preview.id);
    recordReason(result.skippedReasons, preview.path, "No writable content was reconstructed.");
    return;
  }

  const targetExists = !!vault.getAbstractFileByPath(targetPath) || await vault.adapter.exists(targetPath);
  if (targetExists) {
    const current = await readExisting(vault, targetPath, preview.contentType === "binary");
    if (contentsEqual(current, preview.content)) {
      result.applied++;
      result.appliedIds.push(preview.id);
      return;
    }
    if (typeof current === "string" && typeof preview.content === "string") {
      const jsonSettingsMerge = maybeMergeJsonSettings(targetPath, configDir, current, preview.content);
      const merged = jsonSettingsMerge?.content ?? automaticTextMerge(current, preview.content);
      if (merged !== current) {
        await backupExistingContent(vault, targetPath, result.conflictFolder, false);
        await writeContent(vault, targetPath, merged);
        result.backedUp++;
        recordChangedPath(result, targetPath);
      }
      if (jsonSettingsMerge?.preservedLocalValues && !result.preservedLocalSettingsPaths.includes(targetPath)) {
        result.preservedLocalSettingsPaths.push(targetPath);
      }
      result.merged++;
      result.appliedIds.push(preview.id);
      return;
    }
    await backupExistingContent(vault, targetPath, result.conflictFolder, preview.contentType === "binary");
    result.backedUp++;
  }

  await writeContent(vault, targetPath, preview.content);
  recordChangedPath(result, targetPath);
  result.applied++;
  result.appliedIds.push(preview.id);
}

async function applyPreview(
  vault: LiveVaultTarget,
  preview: ReconstructedDocumentPreview,
  options: Pick<LiveVaultApplyOptions, "configDir" | "shouldApplyPath">,
  result: MutableLiveVaultApplyResult
): Promise<void> {
  const targetPath = safeVaultPath(preview.path);
  if (options.shouldApplyPath && !options.shouldApplyPath(targetPath)) {
    result.skipped++;
    result.skippedIds.push(preview.id);
    recordReason(result.skippedReasons, targetPath, "Excluded from sync.");
    return;
  }
  if (isProtectedTarget(targetPath, options.configDir)) {
    result.skipped++;
    result.skippedIds.push(preview.id);
    recordReason(result.skippedReasons, targetPath, "Protected vault location.");
    return;
  }

  if (preview.status !== "ready" && preview.status !== "deleted") {
    if (preview.status === "unsupported") {
      result.skipped++;
      result.skippedIds.push(preview.id);
      recordReason(result.skippedReasons, preview.path, preview.reason ?? "Unsupported remote file format.");
      return;
    }
    result.waiting++;
    recordReason(result.waitingReasons, preview.path, preview.reason ?? `Remote file is ${preview.status}.`);
    return;
  }

  await ensureParentFolder(vault.adapter, targetPath);
  if (preview.status === "deleted") {
    await applyDeletedPreview(vault, preview, targetPath, result);
    return;
  }
  await applyReadyPreview(vault, preview, targetPath, options.configDir, result);
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
    waiting: 0,
    merged: 0,
    backedUp: 0,
    conflicted: 0,
    failed: 0,
    appliedIds: [],
    skippedIds: [],
    changedPaths: [],
    waitingReasons: [],
    skippedReasons: [],
    failedReasons: [],
    preservedLocalSettingsPaths: [],
    conflictFolder: options.conflictFolder
  };

  for (const preview of previews) {
    try {
      await options.yieldToUi?.();
      await applyPreview(vault, preview, options, result);
      await options.yieldToUi?.();
    } catch (error) {
      result.failed++;
      recordReason(result.failedReasons, preview.path, error instanceof Error ? error.message : "Unexpected write failure.");
    }
  }

  return result;
}
