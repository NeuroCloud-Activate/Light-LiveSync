import type { RuntimeSmokeManifest } from "./runtime-smoke-check";
import type { LightweightLiveSyncSettings } from "./settings";

export type RuntimeCapabilitySnapshot = {
  webCrypto: boolean;
  sessionStorage: boolean;
  indexedDb: boolean;
  fetch: boolean;
  abortController: boolean;
  textCodec: boolean;
  base64Codec: boolean;
  workerConstructor: boolean;
  workerScriptAvailable: boolean;
  obsidianRequestApi: boolean;
};

export type RuntimeCapabilityReport = {
  ok: boolean;
  message: string;
  details: string[];
};

export function buildRuntimeCapabilityReport(input: {
  manifest: RuntimeSmokeManifest;
  settings: LightweightLiveSyncSettings;
  snapshot: RuntimeCapabilitySnapshot;
}): RuntimeCapabilityReport {
  const { manifest, settings, snapshot } = input;
  const issues: string[] = [];
  const details = [
    manifest.isDesktopOnly ? "Manifest is desktop-only." : "Manifest allows desktop and mobile.",
    snapshot.webCrypto ? "WebCrypto is available." : "WebCrypto is unavailable.",
    snapshot.indexedDb ? "IndexedDB is usable for local queues." : "IndexedDB is unavailable for local queues.",
    snapshot.sessionStorage ? "Session storage is usable." : "Session storage is unavailable.",
    snapshot.fetch ? "Standard fetch transport is available." : "Standard fetch transport is unavailable.",
    snapshot.obsidianRequestApi ? "Obsidian request API transport is available." : "Obsidian request API transport is unavailable.",
    snapshot.abortController ? "AbortController timeouts are available." : "AbortController timeouts are unavailable.",
    snapshot.textCodec ? "TextEncoder/TextDecoder are available." : "TextEncoder/TextDecoder are unavailable.",
    snapshot.base64Codec ? "Base64 codecs are available." : "Base64 codecs are unavailable.",
    snapshot.workerConstructor && snapshot.workerScriptAvailable
      ? "Background worker path is available."
      : "Background worker is unavailable; main-thread fallback will be used."
  ];

  if (manifest.isDesktopOnly) {
    issues.push("manifest is desktop-only");
  }
  if (!snapshot.webCrypto) {
    issues.push("WebCrypto is unavailable");
  }
  if (!snapshot.indexedDb) {
    issues.push("IndexedDB is unavailable");
  }
  if (settings.keepUnlockedDuringSession && !snapshot.sessionStorage) {
    issues.push("session storage is unavailable");
  }
  if (settings.couchDb.useRequestApi) {
    if (!snapshot.obsidianRequestApi) {
      issues.push("selected Obsidian request API transport is unavailable");
    }
  } else if (!snapshot.fetch) {
    issues.push("selected fetch transport is unavailable");
  }
  if (!snapshot.abortController) {
    issues.push("AbortController is unavailable");
  }
  if (!snapshot.textCodec) {
    issues.push("text codecs are unavailable");
  }
  if (!snapshot.base64Codec) {
    issues.push("base64 codecs are unavailable");
  }

  if (issues.length === 0) {
    return {
      ok: true,
      message: "Runtime capability check passed. Required desktop/mobile browser APIs are available.",
      details
    };
  }

  return {
    ok: false,
    message: `Runtime capability check needs attention: ${issues.join(", ")}.`,
    details
  };
}
