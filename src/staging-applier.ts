import type { ReconstructedDocumentPreview } from "./document-reconstructor";
import type { LiveVaultTarget } from "./live-vault-applier";

export type StagingApplyResult = {
  staged: number;
  skipped: number;
  failed: number;
  stagedIds: string[];
  basePath: string;
};

function cleanPathPart(part: string): string {
  return part
    .replace(/\\/g, "/")
    .replace(/[:*?"<>|#\u0000-\u001f]/g, "_")
    .replace(/^\.+$/, "_")
    .trim()
    .slice(0, 160);
}

function targetPath(basePath: string, sourcePath: string): string {
  const cleaned = sourcePath
    .split("/")
    .map((part) => cleanPathPart(part))
    .filter(Boolean)
    .join("/");
  return `${basePath.replace(/\/+$/, "")}/${cleaned || "untitled.md"}`;
}

async function ensureFolder(vault: LiveVaultTarget, folderPath: string): Promise<void> {
  const parts = folderPath.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!(await vault.adapter.exists(current))) {
      await vault.adapter.mkdir(current);
    }
  }
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return value instanceof ArrayBuffer;
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

export async function applyReadyPreviewsToStaging(
  vault: LiveVaultTarget,
  basePath: string,
  previews: ReconstructedDocumentPreview[]
): Promise<StagingApplyResult> {
  await ensureFolder(vault, basePath);
  const stagedIds: string[] = [];
  let staged = 0;
  let skipped = 0;
  let failed = 0;

  for (const preview of previews) {
    if (preview.status !== "ready" || (typeof preview.content !== "string" && !isArrayBuffer(preview.content))) {
      skipped++;
      continue;
    }

    try {
      const path = targetPath(basePath, preview.path);
      const folder = path.split("/").slice(0, -1).join("/");
      if (folder) {
        await ensureFolder(vault, folder);
      }
      await writeContent(vault, path, preview.content);
      staged++;
      stagedIds.push(preview.id);
    } catch {
      failed++;
    }
  }

  return {
    staged,
    skipped,
    failed,
    stagedIds,
    basePath
  };
}
