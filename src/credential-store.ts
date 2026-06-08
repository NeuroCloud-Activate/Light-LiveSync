import type { CredentialPayload, EncryptedCredentialStore } from "./settings";

const KDF_ITERATIONS = 250000;
const KEY_LENGTH_BITS = 256;

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  window.crypto.getRandomValues(bytes);
  return bytes;
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return window.btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  if (!passphrase) {
    throw new Error("A credential unlock passphrase is required.");
  }

  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    bytesToArrayBuffer(new TextEncoder().encode(passphrase)),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: bytesToArrayBuffer(salt),
      iterations
    },
    keyMaterial,
    {
      name: "AES-GCM",
      length: KEY_LENGTH_BITS
    },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptCredentialPayload(
  payload: CredentialPayload,
  unlockPassphrase: string,
  existing?: EncryptedCredentialStore | null
): Promise<EncryptedCredentialStore> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(unlockPassphrase, salt, KDF_ITERATIONS);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: bytesToArrayBuffer(iv)
    },
    key,
    bytesToArrayBuffer(plaintext)
  );
  const now = Date.now();

  return {
    version: 1,
    kdf: "PBKDF2-SHA256",
    cipher: "AES-GCM",
    iterations: KDF_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(encrypted)),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
}

export async function decryptCredentialPayload(
  store: EncryptedCredentialStore,
  unlockPassphrase: string
): Promise<CredentialPayload> {
  if (store.version !== 1 || store.kdf !== "PBKDF2-SHA256" || store.cipher !== "AES-GCM") {
    throw new Error("Unsupported credential store format.");
  }

  const salt = base64ToBytes(store.salt);
  const iv = base64ToBytes(store.iv);
  const key = await deriveKey(unlockPassphrase, salt, store.iterations);
  const decrypted = await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: bytesToArrayBuffer(iv)
    },
    key,
    bytesToArrayBuffer(base64ToBytes(store.data))
  );
  const parsed = JSON.parse(new TextDecoder().decode(decrypted)) as Partial<CredentialPayload>;

  return {
    couchDbPassword: typeof parsed.couchDbPassword === "string" ? parsed.couchDbPassword : "",
    passphrase: typeof parsed.passphrase === "string" ? parsed.passphrase : ""
  };
}
