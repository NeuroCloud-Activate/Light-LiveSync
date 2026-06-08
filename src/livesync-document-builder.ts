import { fallbackMixedHashEach, mixedHash, sha1 } from "octagonal-wheels/hash/purejs";
import { encrypt as encryptHKDF } from "octagonal-wheels/encryption/hkdf";
import { base64ToBytes, bytesToBase64 } from "./base64";
import { ENTRY_TYPES, type LiveSyncDocument } from "./livesync-constants";

const ID_PREFIX_OBFUSCATED = "f:";
const ID_PREFIX_CHUNK = "h:";
const HASH_ENCRYPTED_PREFIX = "+";
const ENCRYPTED_META_PREFIX = "/\\:";
const SALT_OF_ID = "a83hrf7f\u0003y7sa8g31";
const SEED_MURMURHASH = 0x12345678;
const DEFAULT_TEXT_CHUNK_SIZE = 16 * 1024;
const DEFAULT_BINARY_CHUNK_SIZE = 100 * 1024;

export type LocalFileSnapshot = {
  path: string;
  content: string | ArrayBuffer;
  ctime: number;
  mtime: number;
  size: number;
};

export type LiveSyncBuildOptions = {
  encrypt: boolean;
  passphrase: string;
  syncParameterSalt: string;
  usePathObfuscation: boolean;
  hashAlgorithm: string;
  caseInsensitive?: boolean;
};

export type LiveSyncBuildRuntimeOptions = {
  yieldToUi?(): Promise<void>;
  yieldEveryPieces?: number;
};

export type LiveSyncPushBundle = {
  fileDocument: LiveSyncDocument;
  chunkDocuments: LiveSyncDocument[];
};

type XxHashApi = {
  h64(input: string): bigint;
  h32(input: string): number;
  h32Raw(input: Uint8Array): number;
};

let xxhashApiPromise: Promise<XxHashApi> | undefined;

function runtimeCrypto(): Crypto {
  return self.crypto;
}

function textToBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function exactBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = textToBytes(value);
  const digest = await runtimeCrypto().subtle.digest(
    "SHA-256",
    arrayBufferFromBytes(bytes)
  );
  return bytesToHex(new Uint8Array(digest));
}

function normalisePathForId(path: string, caseInsensitive?: boolean): string {
  const normalised = caseInsensitive ? path.toLowerCase() : path;
  return normalised.startsWith("_") ? `/${normalised}` : normalised;
}

export async function pathToLiveSyncDocumentId(
  path: string,
  passphrase: string | false,
  caseInsensitive?: boolean
): Promise<string> {
  if (path.startsWith(ID_PREFIX_OBFUSCATED)) {
    return path;
  }

  const normalised = normalisePathForId(path, caseInsensitive);
  if (!passphrase) {
    return normalised;
  }

  const [prefix, body] = expandPrefix(normalised);
  if (body.startsWith(ID_PREFIX_OBFUSCATED)) {
    return normalised;
  }

  const hashedPassphrase = await sha256Hex(passphrase);
  const hashedPath = await sha256Hex(`${hashedPassphrase}:${caseInsensitive ? path.toLowerCase() : path}`);
  return `${prefix}${ID_PREFIX_OBFUSCATED}${hashedPath}`;
}

function expandPrefix(value: string): [string, string] {
  const delimiter = value.indexOf(":");
  if (delimiter === -1) {
    return ["", value];
  }
  return [value.slice(0, delimiter + 1), value.slice(delimiter + 1)];
}

async function getXxHashApi(): Promise<XxHashApi> {
  if (!xxhashApiPromise) {
    xxhashApiPromise = import("xxhash-wasm-102").then((module) => {
      const factory = module.default as unknown as () => Promise<XxHashApi>;
      return factory();
    });
  }
  return xxhashApiPromise;
}

function hashedPassphrase(passphrase: string): string {
  const usingLetters = Math.trunc((passphrase.length / 4) * 3);
  return fallbackMixedHashEach(`${SALT_OF_ID}${passphrase.substring(0, usingLetters)}`);
}

function hashedPassphrase32(passphrase: string): number {
  const usingLetters = Math.trunc((passphrase.length / 4) * 3);
  return mixedHash(`${SALT_OF_ID}${passphrase.substring(0, usingLetters)}`, SEED_MURMURHASH)[0];
}

function encryptedHashPrefix(options: LiveSyncBuildOptions): string {
  return options.encrypt ? HASH_ENCRYPTED_PREFIX : "";
}

function mixedHashInput(piece: string, options: LiveSyncBuildOptions): string {
  return options.encrypt
    ? `${piece}${hashedPassphrase(options.passphrase)}${piece.length}`
    : `${piece}-${piece.length}`;
}

function saltedHashInput(piece: string, options: LiveSyncBuildOptions): string {
  return options.encrypt
    ? `${piece}-${hashedPassphrase(options.passphrase)}-${piece.length}`
    : `${piece}-${piece.length}`;
}

function computeLegacyXxHash32(piece: string, options: LiveSyncBuildOptions, xxhash: XxHashApi): string {
  const encoded = textToBytes(piece);
  const hash = options.encrypt
    ? xxhash.h32Raw(encoded) ^ hashedPassphrase32(options.passphrase) ^ piece.length
    : xxhash.h32Raw(encoded) ^ piece.length;
  return encryptedHashPrefix(options) + hash.toString(36);
}

async function computePieceHash(piece: string, options: LiveSyncBuildOptions): Promise<string> {
  const algorithm = options.hashAlgorithm || "xxhash64";
  if (algorithm === "mixed-purejs") {
    return encryptedHashPrefix(options) + fallbackMixedHashEach(mixedHashInput(piece, options));
  }
  if (algorithm === "sha1") {
    return encryptedHashPrefix(options) + await sha1(saltedHashInput(piece, options));
  }

  const xxhash = await getXxHashApi();
  if (algorithm === "") {
    return computeLegacyXxHash32(piece, options, xxhash);
  }

  return encryptedHashPrefix(options) + xxhash.h64(saltedHashInput(piece, options)).toString(36);
}

async function yieldDuringBuild(
  runtime: LiveSyncBuildRuntimeOptions | undefined,
  processedPieces: number,
  totalPieces: number
): Promise<void> {
  if (!runtime?.yieldToUi || processedPieces >= totalPieces) {
    return;
  }

  const yieldEveryPieces = Math.max(1, runtime.yieldEveryPieces ?? 8);
  if (processedPieces % yieldEveryPieces === 0) {
    await runtime.yieldToUi();
  }
}

function splitTextIntoLiveSyncPieces(content: string, maxSize = DEFAULT_TEXT_CHUNK_SIZE): string[] {
  if (!content) {
    return [];
  }
  const pieces: string[] = [];
  let buffer = "";
  for (const line of splitTextByLineEndings(content)) {
    if (buffer && buffer.length + line.length > maxSize) {
      pieces.push(buffer);
      buffer = "";
    }
    if (line.length > maxSize) {
      for (let offset = 0; offset < line.length; offset += maxSize) {
        pieces.push(line.slice(offset, offset + maxSize));
      }
      continue;
    }
    buffer += line;
  }
  if (buffer) {
    pieces.push(buffer);
  }
  return pieces;
}

function splitTextByLineEndings(content: string): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\n") {
      lines.push(content.slice(start, index + 1));
      start = index + 1;
    }
  }
  if (start < content.length) {
    lines.push(content.slice(start));
  }
  return lines;
}

function splitBinaryIntoLiveSyncPieces(content: ArrayBuffer, maxSize = DEFAULT_BINARY_CHUNK_SIZE): string[] {
  const bytes = new Uint8Array(content);
  if (bytes.length === 0) {
    return [];
  }
  const pieces: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += maxSize) {
    pieces.push(bytesToBase64(bytes.slice(offset, offset + maxSize)));
  }
  return pieces;
}

async function maybeEncryptData(data: string, options: LiveSyncBuildOptions): Promise<string> {
  if (!options.encrypt) {
    return data;
  }
  if (!options.passphrase || !options.syncParameterSalt) {
    throw new Error("Encrypted push needs an unlocked passphrase and the remote sync-parameter salt.");
  }
  return encryptHKDF(data, options.passphrase, exactBytes(base64ToBytes(options.syncParameterSalt)));
}

async function maybeEncryptMetadata(
  snapshot: LocalFileSnapshot,
  children: string[],
  options: LiveSyncBuildOptions
): Promise<Pick<LiveSyncDocument, "path" | "mtime" | "ctime" | "size" | "children">> {
  if (!options.encrypt || !options.usePathObfuscation) {
    return {
      path: snapshot.path,
      mtime: snapshot.mtime,
      ctime: snapshot.ctime,
      size: snapshot.size,
      children
    };
  }
  const metadata = {
    path: snapshot.path,
    mtime: snapshot.mtime,
    ctime: snapshot.ctime,
    size: snapshot.size,
    children
  };
  return {
    path: ENCRYPTED_META_PREFIX + await maybeEncryptData(JSON.stringify(metadata), options),
    mtime: 0,
    ctime: 0,
    size: 0,
    children: []
  };
}

export async function buildLiveSyncPushBundle(
  snapshot: LocalFileSnapshot,
  options: LiveSyncBuildOptions,
  runtime?: LiveSyncBuildRuntimeOptions
): Promise<LiveSyncPushBundle> {
  const documentId = await pathToLiveSyncDocumentId(
    snapshot.path,
    options.usePathObfuscation ? options.passphrase : false,
    options.caseInsensitive
  );
  const chunkDocuments = new Map<string, LiveSyncDocument>();
  const children: string[] = [];
  const isBinary = typeof snapshot.content !== "string";
  const pieces = typeof snapshot.content === "string"
    ? splitTextIntoLiveSyncPieces(snapshot.content)
    : splitBinaryIntoLiveSyncPieces(snapshot.content);

  for (const [index, piece] of pieces.entries()) {
    const chunkId = ID_PREFIX_CHUNK + await computePieceHash(piece, options);
    children.push(chunkId);
    if (!chunkDocuments.has(chunkId)) {
      chunkDocuments.set(chunkId, {
        _id: chunkId,
        type: ENTRY_TYPES.CHUNK,
        data: await maybeEncryptData(piece, options),
        ...(options.encrypt ? { e_: true } : {})
      });
    }
    await yieldDuringBuild(runtime, index + 1, pieces.length);
  }

  const metadata = await maybeEncryptMetadata(snapshot, children, options);
  return {
    fileDocument: {
      _id: documentId,
      type: isBinary ? ENTRY_TYPES.NOTE_BINARY : ENTRY_TYPES.NOTE_PLAIN,
      eden: {},
      ...metadata
    },
    chunkDocuments: [...chunkDocuments.values()]
  };
}
