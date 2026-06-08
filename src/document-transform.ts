import { decrypt as decryptHKDF } from "octagonal-wheels/encryption/hkdf";
import { base64ToBytes, Base64DecodeError } from "./base64";
import {
  ENTRY_TYPES,
  isLiveSyncChunkDocument,
  isLiveSyncFileDocument,
  type LiveSyncChunkDocument,
  type LiveSyncFileDocument
} from "./livesync-constants";

export const ENCRYPTED_META_PREFIX = "/\\:";
const HKDF_ENCRYPTED_PREFIX = "%=";
const LEGACY_ENCRYPTED_PREFIX = "%";
const EDEN_ENCRYPTED_KEY = "h:++encrypted";
const EDEN_ENCRYPTED_KEY_HKDF = "h:++encrypted-hkdf";

export type DocumentTransformOptions = {
  passphrase: string;
  syncParameterSalt: string;
  useDynamicIterationCount: boolean;
  e2eeAlgorithm: string;
};

export class DocumentTransformError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DocumentTransformError";
  }
}

type EncryptedMetadata = {
  path?: string;
  mtime?: number;
  ctime?: number;
  size?: number;
  children?: string[];
};

type EdenChunkRecord = Record<string, { data: string; epoch?: number }>;
type LegacyEncryptionModule = {
  decrypt(encryptedResult: string, passphrase: string, autoCalculateIterations: boolean): Promise<string>;
};

let legacyEncryptionModulePromise: Promise<LegacyEncryptionModule> | undefined;

function hasTransformKey(options: DocumentTransformOptions): boolean {
  return !!options.passphrase && !!options.syncParameterSalt;
}

function exactBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function syncParameterSaltBytes(options: DocumentTransformOptions): Uint8Array<ArrayBuffer> {
  try {
    return exactBytes(base64ToBytes(options.syncParameterSalt));
  } catch (error) {
    if (error instanceof Base64DecodeError) {
      throw new DocumentTransformError("Remote sync parameter salt is not valid base64.", { cause: error });
    }
    throw error;
  }
}

async function tryLegacyDecrypt(input: string, passphrase: string, useDynamicIterationCount: boolean): Promise<string> {
  legacyEncryptionModulePromise ??= import("octagonal-wheels/encryption/encryption")
    .then((module) => module as unknown as LegacyEncryptionModule);
  const legacyEncryption = await legacyEncryptionModulePromise;
  const failures: unknown[] = [];
  for (const dynamicIterations of [useDynamicIterationCount, false]) {
    try {
      return await legacyEncryption.decrypt(input, passphrase, dynamicIterations);
    } catch (error) {
      failures.push(error);
    }
  }
  throw new DocumentTransformError("Legacy document decryption failed.", { cause: failures[0] });
}

async function decryptMaybeEncryptedData(input: string, options: DocumentTransformOptions): Promise<string> {
  if (!options.passphrase) {
    throw new DocumentTransformError("A vault E2EE passphrase is required.");
  }

  if (input.startsWith(HKDF_ENCRYPTED_PREFIX)) {
    if (!options.syncParameterSalt) {
      throw new DocumentTransformError("Remote sync parameter salt is required for HKDF decryption.");
    }
    return decryptHKDF(input, options.passphrase, syncParameterSaltBytes(options));
  }

  if (input.startsWith(LEGACY_ENCRYPTED_PREFIX)) {
    return tryLegacyDecrypt(input, options.passphrase, options.useDynamicIterationCount);
  }

  throw new DocumentTransformError("Unknown encrypted document format.");
}

export function hasEncryptedMetadata(doc: LiveSyncFileDocument): boolean {
  return doc.path.startsWith(ENCRYPTED_META_PREFIX) || doc.path.startsWith(LEGACY_ENCRYPTED_PREFIX);
}

export function isEncryptedChunk(doc: LiveSyncChunkDocument): boolean {
  return doc.e_ === true;
}

export async function decryptFileMetadata(
  doc: LiveSyncFileDocument,
  options: DocumentTransformOptions
): Promise<LiveSyncFileDocument> {
  if (!hasEncryptedMetadata(doc)) {
    return doc;
  }

  if (doc.path.startsWith(LEGACY_ENCRYPTED_PREFIX)) {
    if (!options.passphrase) {
      throw new DocumentTransformError("Encrypted legacy path needs an unlocked passphrase.");
    }
    return {
      ...doc,
      path: await tryLegacyDecrypt(doc.path, options.passphrase, options.useDynamicIterationCount)
    };
  }

  if (!hasTransformKey(options)) {
    throw new DocumentTransformError("Encrypted metadata needs an unlocked passphrase and sync parameter salt.");
  }

  const encrypted = doc.path.slice(ENCRYPTED_META_PREFIX.length);
  const metadata = JSON.parse(
    await decryptHKDF(encrypted, options.passphrase, syncParameterSaltBytes(options))
  ) as EncryptedMetadata;

  if (!metadata.path) {
    throw new DocumentTransformError("Encrypted metadata did not include a path.");
  }

  return {
    ...doc,
    path: metadata.path,
    mtime: typeof metadata.mtime === "number" ? metadata.mtime : doc.mtime,
    ctime: typeof metadata.ctime === "number" ? metadata.ctime : doc.ctime,
    size: typeof metadata.size === "number" ? metadata.size : doc.size,
    children: Array.isArray(metadata.children) ? metadata.children : doc.children
  };
}

function encryptedEdenPayload(doc: LiveSyncFileDocument, key: string): string | undefined {
  const eden = doc.eden;
  if (!eden || typeof eden !== "object") {
    return undefined;
  }
  const candidate = eden[key];
  if (!candidate || typeof candidate !== "object") {
    return undefined;
  }
  const data = (candidate as { data?: unknown }).data;
  return typeof data === "string" ? data : undefined;
}

async function decryptEden(doc: LiveSyncFileDocument, options: DocumentTransformOptions): Promise<LiveSyncFileDocument> {
  const hkdfPayload = encryptedEdenPayload(doc, EDEN_ENCRYPTED_KEY_HKDF);
  if (hkdfPayload) {
    if (!hasTransformKey(options)) {
      throw new DocumentTransformError("Encrypted Eden needs an unlocked passphrase and sync parameter salt.");
    }
    return {
      ...doc,
      eden: JSON.parse(
        await decryptHKDF(hkdfPayload, options.passphrase, syncParameterSaltBytes(options))
      ) as EdenChunkRecord
    };
  }

  const legacyPayload = encryptedEdenPayload(doc, EDEN_ENCRYPTED_KEY);
  if (legacyPayload) {
    if (!options.passphrase) {
      throw new DocumentTransformError("Encrypted legacy Eden needs an unlocked passphrase.");
    }
    return {
      ...doc,
      eden: JSON.parse(
        await tryLegacyDecrypt(legacyPayload, options.passphrase, options.useDynamicIterationCount)
      ) as EdenChunkRecord
    };
  }

  return doc;
}

export async function decryptChunkData(
  doc: LiveSyncChunkDocument,
  options: DocumentTransformOptions
): Promise<LiveSyncChunkDocument> {
  if (!isEncryptedChunk(doc)) {
    return doc;
  }
  return {
    ...doc,
    data: await decryptMaybeEncryptedData(doc.data, options),
    e_: undefined
  };
}

export async function decryptFileDocument(
  doc: LiveSyncFileDocument,
  options: DocumentTransformOptions
): Promise<LiveSyncFileDocument> {
  if (!isLiveSyncFileDocument(doc)) {
    throw new DocumentTransformError("Document is not a LiveSync file document.");
  }
  const decrypted = await decryptEden(await decryptFileMetadata(doc, options), options);
  if (decrypted.type === ENTRY_TYPES.NOTE_LEGACY && typeof decrypted.data === "string" && "e_" in decrypted) {
    return {
      ...decrypted,
      data: await decryptMaybeEncryptedData(decrypted.data, options),
      e_: undefined
    } as LiveSyncFileDocument;
  }
  return decrypted;
}

export async function decryptChunkDocument(
  doc: LiveSyncChunkDocument,
  options: DocumentTransformOptions
): Promise<LiveSyncChunkDocument> {
  if (!isLiveSyncChunkDocument(doc)) {
    throw new DocumentTransformError("Document is not a LiveSync chunk document.");
  }
  return decryptChunkData(doc, options);
}
