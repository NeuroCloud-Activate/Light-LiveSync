import type { ReconstructedDocumentPreview } from "./document-reconstructor";
import type { LiveVaultTarget } from "./live-vault-applier";

export type PreviewExportResult = {
  exported: number;
  skipped: number;
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

function previewPath(basePath: string, sourcePath: string): string {
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

export async function exportReadyPreviews(
  vault: LiveVaultTarget,
  basePath: string,
  previews: ReconstructedDocumentPreview[]
): Promise<PreviewExportResult> {
  await ensureFolder(vault, basePath);
  let exported = 0;
  let skipped = 0;

  for (const preview of previews) {
    if (preview.status !== "ready" || (typeof preview.content !== "string" && !isArrayBuffer(preview.content))) {
      skipped++;
      continue;
    }

    const targetPath = previewPath(basePath, preview.path);
    const folder = targetPath.split("/").slice(0, -1).join("/");
    if (folder) {
      await ensureFolder(vault, folder);
    }
    await writeContent(vault, targetPath, preview.content);
    exported++;
  }

  return {
    exported,
    skipped,
    basePath
  };
}
