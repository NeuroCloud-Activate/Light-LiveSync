# Security Notes

This plugin can protect synced vault content and avoid unsafe local persistence, but CouchDB account creation, password policy, TLS, firewalling, and database membership are controlled by the CouchDB server.

## What The Plugin Enforces

- E2EE is required by default for server sync.
- The vault E2EE passphrase is needed before encrypted content can be pushed or applied.
- Raw CouchDB passwords and raw E2EE passphrases are blanked before plugin settings are saved.
- Saved credentials are stored in an encrypted local credential store.
- The optional session unlock cache uses Obsidian session storage for renderer-refresh recovery only; it is scoped to vault name, plugin id, CouchDB URI, database, and username.
- Initial-device setup restricts created or existing databases to the current CouchDB username when the server accepts the `_security` update.
- Add-device setup URIs are generated only after the original device has seen LiveSync sync parameters on the remote database. The URI payload is encrypted with the shared E2EE/setup passphrase and does not create or initialize databases on the new device.
- Setup URI and QR imports are marked as additional devices. Their connection checks read the existing database and inspect sync parameters only; they do not call the database-create or sync-parameter-create paths.

## What The CouchDB Server Must Enforce

CouchDB database access is controlled by the server. A secure deployment should verify:

- CouchDB has server admin users configured.
- Anonymous or arbitrary-user access is not allowed for the vault database.
- The database `_security` object has explicit `members` or `roles` for sync users.
- The server default security is not set to `everyone`.
- CouchDB is reachable only over HTTPS, a trusted VPN, or a similarly protected network path.
- The `_users` database remains protected so users cannot browse or edit other users' credentials.

According to CouchDB's own documentation, database `members` can read and write regular documents, while database `admins` can also edit design documents and database membership. If no members or roles are set, database access can be open to any authenticated user depending on server defaults and version. CouchDB 3.x defaults newly-created databases to admin-only, but explicit `_security` membership is still the clearest deployable posture.

## Adding Another Device Securely

Recommended pattern:

- Initial device: connect directly to CouchDB, create or verify the database, let the plugin apply database `_security` membership for the CouchDB user, and let the plugin initialize LiveSync sync parameters.
- Additional devices: use **Generate URI** on the original device, then **Use setup URI** on the new device with the same shared E2EE passphrase.

Alternative patterns:

- Shared sync user: install the plugin on the new device and import the same setup URI or enter the same CouchDB credentials and E2EE passphrase.
- Per-device users: a CouchDB server admin creates a new CouchDB user, then adds that username or a shared role to the vault database `_security` members. The device then uses its own CouchDB username/password plus the same E2EE passphrase.

Do not rely on the plugin to create CouchDB users. That would blur the boundary between vault sync and server administration. The plugin should verify and use access; the server should grant access.

Treat generated setup URIs as temporary invite codes. They are encrypted, but anyone with both the URI and the shared passphrase can connect to the same sync database. Revoke a lost or leaked device by changing its CouchDB password, removing its user or role from database `_security`, and rotating the vault E2EE passphrase if the passphrase may also be exposed.

## Transport Security

Use `https://` for remote CouchDB whenever traffic can leave a trusted host boundary. With plain `http://`, CouchDB Basic Authentication credentials are not encrypted in transit. Vault E2EE still protects note content, but the CouchDB username/password can be exposed on the network.

For home or lab deployments, acceptable secure patterns include:

- HTTPS directly from CouchDB.
- HTTPS on a reverse proxy in front of CouchDB.
- VPN-only CouchDB access with firewall rules preventing direct public exposure.
- Local-only testing on `localhost`.

## Plugin Security Checklist

Before trusting a new deployment:

- Run the plugin's CouchDB connection check.
- Confirm the notice says database access was restricted to the CouchDB user, or confirm the database `_security` members/roles manually on the server.
- Confirm `data.json` does not contain a raw CouchDB password or raw E2EE passphrase.
- Confirm the server URL uses HTTPS or is protected by VPN/LAN firewalling.
- Confirm additional devices were added from a generated setup URI or have a deliberate CouchDB user and the shared E2EE passphrase.
- Confirm lost devices can be revoked by changing the CouchDB password or removing that user/role from database `_security`.
