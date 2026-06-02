import type { CredentialPayload } from "./settings";

export type SessionCredentialScope = {
  vaultName: string;
  pluginId: string;
  uri: string;
  database: string;
  username: string;
};

type StoredSessionCredential = {
  version: 1;
  savedAt: number;
  scope: SessionCredentialScope;
  key: string;
  iv: string;
  data: string;
};

type StoredSessionCredentialReloadProof = {
  version: 1;
  savedAt: number;
  scope: SessionCredentialScope;
  nonce: string;
  digest: string;
};

export type SessionCredentialReloadProofResult = "matched" | "missing" | "mismatch" | "unavailable";

const KEY_LENGTH_BYTES = 32;

function storageKey(scope: SessionCredentialScope): string {
  const vault = encodeURIComponent(scope.vaultName || "vault");
  const plugin = encodeURIComponent(scope.pluginId || "lightweight-livesync");
  return `${plugin}:${vault}:session-credentials:v1`;
}

function reloadProofStorageKey(scope: SessionCredentialScope): string {
  const vault = encodeURIComponent(scope.vaultName || "vault");
  const plugin = encodeURIComponent(scope.pluginId || "lightweight-livesync");
  return `${plugin}:${vault}:session-credentials-reload-proof:v1`;
}

function hasSessionStorage(): boolean {
  try {
    return typeof globalThis.sessionStorage !== "undefined";
  } catch {
    return false;
  }
}

function hasWebCrypto(): boolean {
  return !!globalThis.crypto?.subtle && typeof globalThis.crypto.getRandomValues === "function";
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function scopesMatch(left: SessionCredentialScope, right: SessionCredentialScope): boolean {
  return (
    left.vaultName === right.vaultName &&
    left.pluginId === right.pluginId &&
    left.uri === right.uri &&
    left.database === right.database &&
    left.username === right.username
  );
}

function isSessionCredentialScope(value: unknown): value is SessionCredentialScope {
  const scope = value as Partial<SessionCredentialScope> | undefined;
  return (
    !!scope &&
    typeof scope.vaultName === "string" &&
    typeof scope.pluginId === "string" &&
    typeof scope.uri === "string" &&
    typeof scope.database === "string" &&
    typeof scope.username === "string"
  );
}

function readJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function isStoredSessionCredential(value: Record<string, unknown> | null): value is StoredSessionCredential {
  return (
    !!value &&
    value.version === 1 &&
    isSessionCredentialScope(value.scope) &&
    typeof value.key === "string" &&
    typeof value.iv === "string" &&
    typeof value.data === "string"
  );
}

function isStoredSessionCredentialReloadProof(
  value: Record<string, unknown> | null
): value is StoredSessionCredentialReloadProof {
  return (
    !!value &&
    value.version === 1 &&
    isSessionCredentialScope(value.scope) &&
    typeof value.nonce === "string" &&
    typeof value.digest === "string"
  );
}

async function importSessionKey(rawKey: Uint8Array): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    "raw",
    bytesToArrayBuffer(rawKey),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

async function credentialReloadDigest(
  scope: SessionCredentialScope,
  payload: CredentialPayload,
  nonce: string
): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify({
    scope,
    nonce,
    couchDbPassword: payload.couchDbPassword,
    passphrase: payload.passphrase
  }));
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytesToArrayBuffer(encoded)
  );
  return bytesToBase64(new Uint8Array(digest));
}

function credentialPayloadFromUnknown(value: unknown): CredentialPayload {
  const parsed = value as Partial<CredentialPayload> | undefined;
  return {
    couchDbPassword: typeof parsed?.couchDbPassword === "string" ? parsed.couchDbPassword : "",
    passphrase: typeof parsed?.passphrase === "string" ? parsed.passphrase : ""
  };
}

async function decryptStoredSessionCredential(stored: StoredSessionCredential): Promise<CredentialPayload> {
  const key = await importSessionKey(base64ToBytes(stored.key));
  const decrypted = await globalThis.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytesToArrayBuffer(base64ToBytes(stored.iv)) },
    key,
    bytesToArrayBuffer(base64ToBytes(stored.data))
  );
  return credentialPayloadFromUnknown(JSON.parse(new TextDecoder().decode(decrypted)));
}

export async function saveSessionCredentialPayload(
  scope: SessionCredentialScope,
  payload: CredentialPayload
): Promise<boolean> {
  if (!hasSessionStorage() || !hasWebCrypto()) {
    return false;
  }

  const rawKey = randomBytes(KEY_LENGTH_BYTES);
  const iv = randomBytes(12);
  const key = await importSessionKey(rawKey);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: bytesToArrayBuffer(iv) },
    key,
    bytesToArrayBuffer(plaintext)
  );

  const stored: StoredSessionCredential = {
    version: 1,
    savedAt: Date.now(),
    scope,
    key: bytesToBase64(rawKey),
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(encrypted))
  };
  globalThis.sessionStorage.setItem(storageKey(scope), JSON.stringify(stored));
  return true;
}

export async function saveSessionCredentialReloadProof(
  scope: SessionCredentialScope,
  payload: CredentialPayload
): Promise<boolean> {
  if (!hasSessionStorage() || !hasWebCrypto()) {
    return false;
  }

  const nonce = bytesToBase64(randomBytes(24));
  const stored: StoredSessionCredentialReloadProof = {
    version: 1,
    savedAt: Date.now(),
    scope,
    nonce,
    digest: await credentialReloadDigest(scope, payload, nonce)
  };
  globalThis.sessionStorage.setItem(reloadProofStorageKey(scope), JSON.stringify(stored));
  return true;
}

export async function verifySessionCredentialReloadProof(
  scope: SessionCredentialScope,
  payload: CredentialPayload
): Promise<SessionCredentialReloadProofResult> {
  if (!hasSessionStorage() || !hasWebCrypto()) {
    return "unavailable";
  }

  const raw = globalThis.sessionStorage.getItem(reloadProofStorageKey(scope));
  if (!raw) {
    return "missing";
  }

  try {
    const stored = readJsonObject(raw);
    if (!isStoredSessionCredentialReloadProof(stored) || !scopesMatch(stored.scope, scope)) {
      return "mismatch";
    }
    const digest = await credentialReloadDigest(scope, payload, stored.nonce);
    return digest === stored.digest ? "matched" : "mismatch";
  } catch {
    return "mismatch";
  }
}

export async function loadSessionCredentialPayload(
  scope: SessionCredentialScope
): Promise<CredentialPayload | null> {
  if (!hasSessionStorage() || !hasWebCrypto()) {
    return null;
  }

  const raw = globalThis.sessionStorage.getItem(storageKey(scope));
  if (!raw) {
    return null;
  }

  try {
    const stored = readJsonObject(raw);
    if (!stored) {
      clearSessionCredentialPayload(scope);
      return null;
    }
    if (!isStoredSessionCredential(stored) || !scopesMatch(stored.scope, scope)) {
      return null;
    }
    return await decryptStoredSessionCredential(stored);
  } catch {
    clearSessionCredentialPayload(scope);
    return null;
  }
}

export function clearSessionCredentialPayload(scope: SessionCredentialScope): void {
  if (!hasSessionStorage()) {
    return;
  }
  globalThis.sessionStorage.removeItem(storageKey(scope));
}

export function clearSessionCredentialReloadProof(scope: SessionCredentialScope): void {
  if (!hasSessionStorage()) {
    return;
  }
  globalThis.sessionStorage.removeItem(reloadProofStorageKey(scope));
}
