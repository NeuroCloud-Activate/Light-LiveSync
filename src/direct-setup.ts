import {
  DEFAULT_SETTINGS,
  normaliseCouchDbUri,
  normaliseDatabaseName,
  type LightweightLiveSyncSettings
} from "./settings";

export type DirectCouchDbSetupInput = {
  hostname: string;
  database: string;
  passphrase: string;
  username: string;
  password: string;
};

export type DirectCouchDbSetupField = keyof DirectCouchDbSetupInput;

export type DirectCouchDbSetupValueSources = Partial<Record<DirectCouchDbSetupField, { value: string }>>;

export type DirectCouchDbSetupFieldDescription = {
  label: string;
  description: string;
};

export const DIRECT_SETUP_FIELD_DESCRIPTIONS: Record<DirectCouchDbSetupField, DirectCouchDbSetupFieldDescription> = {
  hostname: {
    label: "hostname",
    description: "CouchDB server address from the setup script. Use host:port or https://host:port; http:// is added when omitted."
  },
  database: {
    label: "database",
    description: "CouchDB database to create or reuse for this vault. The connection check confirms the account can access it."
  },
  passphrase: {
    label: "passphrase",
    description: "Shared vault E2EE secret. Required on every device; it encrypts synced note content and protects saved local credentials."
  },
  username: {
    label: "username",
    description: "CouchDB account name with permission to read and write the selected database. If the plugin creates the database, it restricts access to this user."
  },
  password: {
    label: "password",
    description: "Password for the CouchDB account. It is used to connect, then saved only inside encrypted plugin data."
  }
};

export const COUCHDB_SETUP_SCRIPT_URL =
  "https://raw.githubusercontent.com/NeuroCloud-Activate/Light-LiveSync/main/utils/couchdb_setupuri.ts";

const SECRET_PLACEHOLDERS: Record<"passphrase" | "password", string> = {
  passphrase: "PASTE_SHARED_E2EE_PASSPHRASE",
  password: "PASTE_COUCHDB_PASSWORD"
};

export function normaliseDirectCouchDbSetupInput(input: DirectCouchDbSetupInput): DirectCouchDbSetupInput {
  return {
    hostname: normaliseCouchDbUri(input.hostname),
    database: normaliseDatabaseName(input.database),
    passphrase: input.passphrase,
    username: input.username.trim(),
    password: input.password
  };
}

export function directCouchDbSetupInputFromValueSources(
  input: DirectCouchDbSetupInput,
  sources: DirectCouchDbSetupValueSources
): DirectCouchDbSetupInput {
  return {
    hostname: sources.hostname?.value ?? input.hostname,
    database: sources.database?.value ?? input.database,
    passphrase: sources.passphrase?.value ?? input.passphrase,
    username: sources.username?.value ?? input.username,
    password: sources.password?.value ?? input.password
  };
}

export function validateDirectCouchDbSetupInput(input: DirectCouchDbSetupInput): void {
  const normalised = normaliseDirectCouchDbSetupInput(input);
  if (!normalised.hostname) {
    throw new Error("hostname is required.");
  }
  if (!normalised.database) {
    throw new Error("database is required.");
  }
  if (!normalised.passphrase) {
    throw new Error("passphrase is required for end-to-end encryption.");
  }
  if (!normalised.username) {
    throw new Error("username is required.");
  }
  if (!normalised.password) {
    throw new Error("password is required.");
  }
}

export function settingsFromDirectCouchDbSetup(input: DirectCouchDbSetupInput): LightweightLiveSyncSettings {
  const normalised = normaliseDirectCouchDbSetupInput(input);
  validateDirectCouchDbSetupInput(normalised);

  return {
    ...DEFAULT_SETTINGS,
    configured: true,
    couchDb: {
      ...DEFAULT_SETTINGS.couchDb,
      uri: normalised.hostname,
      database: normalised.database,
      username: normalised.username,
      password: normalised.password
    },
    requireE2EE: true,
    encrypt: true,
    passphrase: normalised.passphrase,
    usePathObfuscation: true,
    syncOnStart: true,
    syncOnSave: true,
    periodicSync: true
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function buildCouchDbSetupCommand(input: DirectCouchDbSetupInput): string {
  const normalised = normaliseDirectCouchDbSetupInput(input);
  const commandInput: DirectCouchDbSetupInput = {
    ...normalised,
    passphrase: normalised.passphrase || SECRET_PLACEHOLDERS.passphrase,
    password: normalised.password || SECRET_PLACEHOLDERS.password
  };

  return [
    `export hostname=${shellQuote(commandInput.hostname)}`,
    `export database=${shellQuote(commandInput.database)}`,
    `export passphrase=${shellQuote(commandInput.passphrase)}`,
    `export username=${shellQuote(commandInput.username)}`,
    `export password=${shellQuote(commandInput.password)}`,
    `deno run -A ${COUCHDB_SETUP_SCRIPT_URL}`
  ].join("\n");
}
