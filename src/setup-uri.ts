import {
  decrypt,
  ENCRYPT_V1_PREFIX_PROBABLY,
  ENCRYPT_V2_PREFIX,
  ENCRYPT_V3_PREFIX
} from "octagonal-wheels/encryption/encryption";
import {
  decryptWithEphemeralSalt,
  HKDF_SALTED_ENCRYPTED_PREFIX
} from "octagonal-wheels/encryption/hkdf";
import type { UpstreamSetupSettings } from "./settings";

export const CONFIG_URI_BASE = "obsidian://setuplivesync?settings=";
export const CONFIG_URI_BASE_QR = "obsidian://setuplivesync?settingsQR=";

const SETUP_URI_IN_TEXT_PATTERN = /obsidian:\/\/setuplivesync\?settings=[^\s"'<>]+/i;
const SETUP_URI_QR_IN_TEXT_PATTERN = /obsidian:\/\/setuplivesync\?settingsQR=[^\s"'<>]+/i;

export class SetupUriError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SetupUriError";
  }
}

async function tryLegacyDecrypt(encrypted: string, passphrase: string): Promise<string> {
  const failures: unknown[] = [];
  for (const dynamicIterations of [false, true]) {
    try {
      return await decrypt(encrypted, passphrase, dynamicIterations);
    } catch (error) {
      failures.push(error);
    }
  }
  throw new SetupUriError("Could not decrypt legacy setup URI payload.", { cause: failures[0] });
}

export async function decryptSetupString(encrypted: string, passphrase: string): Promise<string> {
  if (encrypted.startsWith(HKDF_SALTED_ENCRYPTED_PREFIX)) {
    return decryptWithEphemeralSalt(encrypted, passphrase);
  }

  if (
    encrypted.startsWith(ENCRYPT_V2_PREFIX) ||
    encrypted.startsWith(ENCRYPT_V3_PREFIX) ||
    encrypted.startsWith(ENCRYPT_V1_PREFIX_PROBABLY)
  ) {
    return tryLegacyDecrypt(encrypted, passphrase);
  }

  throw new SetupUriError("Unsupported setup URI encryption format.");
}

export function extractSetupPayload(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new SetupUriError("Setup URI is empty.");
  }

  if (SETUP_URI_QR_IN_TEXT_PATTERN.test(trimmed)) {
    throw new SetupUriError("QR setup links are not supported here. Paste the text setup URI that contains settings=.");
  }

  const embeddedSetupUri = trimmed.match(SETUP_URI_IN_TEXT_PATTERN)?.[0];
  const candidate = embeddedSetupUri ?? trimmed;

  if (candidate.startsWith(CONFIG_URI_BASE)) {
    return candidate.slice(CONFIG_URI_BASE.length);
  }

  try {
    const parsed = new URL(candidate);
    const settings = parsed.searchParams.get("settings");
    if (settings) {
      return settings;
    }
  } catch {
    // The Obsidian protocol handler passes the payload value rather than a full URL.
  }

  return candidate;
}

export async function decodeSettingsFromSetupUri(
  uriOrPayload: string,
  passphrase: string
): Promise<UpstreamSetupSettings> {
  const payload = extractSetupPayload(uriOrPayload);
  const encryptedSetting = decodeURIComponent(payload);
  const decrypted = await decryptSetupString(encryptedSetting, passphrase);
  const parsed = JSON.parse(decrypted) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SetupUriError("Setup URI did not decode to a settings object.");
  }

  return parsed as UpstreamSetupSettings;
}
