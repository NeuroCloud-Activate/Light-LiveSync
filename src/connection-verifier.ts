import type {
  CouchDbInfo,
  EnsureDatabaseResult,
  EnsureSyncParametersResult,
  RemoteInspection
} from "./couchdb-client";
import { DOCID_SYNC_PARAMETERS, ENTRY_TYPES } from "./livesync-constants";

export type CouchDbConnectionVerifierClient = {
  getDatabaseInfo?(): Promise<CouchDbInfo>;
  ensureDatabase(): Promise<EnsureDatabaseResult>;
  secureDatabaseForCurrentUser?(): Promise<unknown>;
  ensureSyncParameters(): Promise<EnsureSyncParametersResult>;
  inspect(): Promise<RemoteInspection>;
};

export type CouchDbConnectionVerifierOptions = {
  allowDatabaseCreation?: boolean;
  allowSyncParameterCreation?: boolean;
};

export type CouchDbConnectionVerification = {
  database: EnsureDatabaseResult;
  syncParameters: EnsureSyncParametersResult;
  inspection: RemoteInspection;
  databaseMessage: string;
  securityMessage: string;
  syncParametersMessage: string;
  statusMessage: string;
  noticeMessage: string;
};

export async function verifyCouchDbConnection(
  client: CouchDbConnectionVerifierClient,
  options: CouchDbConnectionVerifierOptions = {}
): Promise<CouchDbConnectionVerification> {
  const allowDatabaseCreation = options.allowDatabaseCreation ?? true;
  const allowSyncParameterCreation = options.allowSyncParameterCreation ?? true;
  const database = allowDatabaseCreation
    ? await client.ensureDatabase()
    : {
        created: false,
        info: await readExistingDatabaseInfo(client)
      };
  let securedDatabase = false;
  if (allowDatabaseCreation && client.secureDatabaseForCurrentUser) {
    await client.secureDatabaseForCurrentUser();
    securedDatabase = true;
  }
  const syncParameters = allowSyncParameterCreation
    ? await client.ensureSyncParameters()
    : undefined;
  const inspection = await client.inspect();
  const effectiveSyncParameters = syncParameters ?? syncParametersFromInspection(inspection);
  const databaseMessage = database.created ? "created" : "found and ready";
  const securityMessage = securedDatabase ? "database access restricted to this CouchDB user" : "database security unchanged";
  const syncParametersMessage = effectiveSyncParameters.created
    ? "sync parameters created"
    : inspection.syncParametersPresent
      ? "sync parameters ready"
      : "sync parameters missing; initialize them from the original device";

  return {
    database,
    syncParameters: effectiveSyncParameters,
    inspection,
    databaseMessage,
    securityMessage,
    syncParametersMessage,
    statusMessage: `CouchDB ${databaseMessage}; ${securedDatabase ? "database access restricted; " : ""}${syncParametersMessage}`,
    noticeMessage: `CouchDB credentials verified. Database ${databaseMessage}; ${securityMessage}; ${syncParametersMessage}.`
  };
}

async function readExistingDatabaseInfo(client: CouchDbConnectionVerifierClient): Promise<CouchDbInfo> {
  if (!client.getDatabaseInfo) {
    throw new Error("Read-only CouchDB verification requires getDatabaseInfo support.");
  }
  return client.getDatabaseInfo();
}

function syncParametersFromInspection(inspection: RemoteInspection): EnsureSyncParametersResult {
  return {
    created: false,
    parameters: {
      _id: DOCID_SYNC_PARAMETERS,
      type: ENTRY_TYPES.SYNC_PARAMETERS,
      protocolVersion: 2,
      pbkdf2salt: inspection.syncParameterSalt
    }
  };
}
