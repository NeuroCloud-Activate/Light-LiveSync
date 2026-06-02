# Changelog

## 0.1.18

- Adds background file versioning after successful uploads.
- Keeps version history bounded to 10 versions per file or 90 days.
- Reuses existing encrypted CouchDB content chunks for version history to avoid duplicate file uploads.
- Adds a dedicated Recovery settings tab for restoring previous synced versions and local recovery backups.
- Creates a local recovery backup before replacing a file with a restored version.
- Adds Activity-tab metrics for version history saved, skipped, pruned, and failed counts.

## 0.1.17

- Simplifies the status bar to `Ready`, `Syncing`, and `Completed`; completed syncs hold for 3 seconds before returning to ready.
- Keeps upload/download values in the status bar as KBps rates only.
- Loads the sync worker from the local bundled source as a Blob worker to avoid blocked Obsidian `app://` worker URLs.
- Keeps worker startup failures visible in the Activity log with a short diagnostic and uses the main-thread builder only as a fallback.
- Adds session RAM caches for pushed fingerprints, worker source, and progress-log persistence to reduce repeated IndexedDB/settings writes during sync.
- Shows recovery backup restore controls on the main Sync tab as well as Sync activity, with clearer wording when no backup was created.

## 0.1.16

- Changes the status bar to show upload/download data rates as `LLS:Status (#U/#D KBps)` instead of file counts.
- Keeps file counts, bytes read/received, and plain-language sync details in the Activity tab.
- Refreshes the Activity log console while settings are open so long syncs do not appear stalled.
- Reduces automatic runtime-check noise and automatically continues when a sync pass leaves more upload/download work queued.

## 0.1.15

- Adds live sync progress reporting so manual sync no longer looks stuck after files are queued.
- Shows compact upload/download progress and KBps in the status bar.
- Writes plain-language activity log milestones for server checks, uploads, downloads, apply work, and sync finish.

## 0.1.14

- Tracks the compiled root `main.js` and `sync-worker.js` files so copying the GitHub repo folder into a vault plugin folder can load normally.
- Clarifies manual installation expectations for the plugin folder.

## 0.1.13

- Adds a GitHub Actions release workflow that builds, tests, packages, verifies, and publishes release assets from the source repository.
- Generates GitHub artifact attestations for `main.js`, `styles.css`, `manifest.json`, `sync-worker.js`, and the release zip.

## 0.1.12

- Applies pulled remote files in batches by default instead of one-at-a-time.
- Adds an advanced setting for the maximum remote files applied per sync.
- Adds Activity-tab recovery controls for restoring files from automatic recovery backups.
- Cleans up README wording around automatic first sync, batched pull/apply behavior, and unnecessary testing sections.

## 0.1.11

- Adds punctuation to the plugin manifest description.
- Makes first full-vault sync automatic for setup/startup/periodic sync when the remote has no current vault documents.
- Adds harness coverage proving setup-import can queue and push the current vault without manual Sync now.

## 0.1.10

- Expands manual sync to recursively include vault config, hidden files, and other plugin data through the vault adapter.
- Excludes Light-LiveSync's own volatile runtime data and generated preview/staging/conflict folders to avoid sync loops and credential-state propagation.
- Uses larger text chunks and batched CouchDB bulk writes so large text bundles and attachments sync without oversized requests.
- Skips pulling back this device's own first full-vault upload when the remote has no current vault documents.
- Adds tests for vault scan rules, first-upload pull skipping, and larger fallback chunk/yield behavior.

## 0.1.9

- Makes manual sync scan and queue the current vault first, so first-time sync uploads existing vault files instead of only already-captured edit events.
- Shows completed push/pull sync results as `Synced` in the compact status bar instead of leaving the status looking stuck on syncing.
- Marks interrupted previous syncs on startup so stale runtime state does not look like an active sync forever.
- Improves the add-device setup URI modal, advanced settings controls, selectable settings text, and activity log console layout.

## 0.1.8

- Accepts setup URI imports pasted from full server terminal output, including surrounding quotes or prompt text.
- Clarifies that the setup URI screen can find the link inside copied CouchDB helper output.

## 0.1.7

- Revises setup wording around Server Domain, Database Name, Database User, and Database Password from the server-side CouchDB instance.
- Clarifies how those setup fields map into the generated setup URI.
- Improves spacing and full-width field layout in the Prepare command modal.

## 0.1.6

- Removes the misleading Connect action from the CouchDB command-prep modal.
- Adds optional CouchDB admin credentials to the copied setup command for creating or updating the sync user and database.
- Improves the server-side setup helper's HTTP 401 guidance and verifies the sync user after setup.
- Renames the settings action to Prepare command so setup clearly goes through the generated setup URI.

## 0.1.5

- Keeps the Connect CouchDB password field blank when reopening setup.
- Adds a recent activity log to the Sync activity tab so setup and sync errors can be reviewed after short popups disappear.
- Reorganizes setup into numbered steps and clarifies that the copied setup command should run on the self-hosted server side where CouchDB is reachable.
- Narrows the setup URI modal and settings layout for easier reading.

## 0.1.4

- Adds a repo-hosted CouchDB setup helper that can create or verify the database, prepare sync parameters, and print a setup URI.
- Adds a copyable setup command inside the plugin for recovery when in-app database creation is blocked.
- Saves direct-setup host, database, username, and encrypted CouchDB password after setup errors while keeping passphrases unsaved until setup succeeds.
- Replaces the settings view row with top tabs.
- Removes the visible manual unlock flow from normal use; saved credentials restore automatically on the same device after setup.
- Adds a CouchDB connection summary to the Sync activity tab.

## 0.1.3

- Updates the public plugin description and author metadata.

## 0.1.2

- Improves CouchDB setup handling for HTTP 401/403 responses.
- Retries direct setup through the app request transport when the first transport may be blocked.
- Gives clearer setup guidance for username, password, database access, and permission failures.

## 0.1.1

- Restores saved sync credentials automatically on app start for smoother mobile use.
- Normalizes CouchDB addresses more carefully while preserving HTTPS domains.
- Raises the default upload batch size for full-vault first syncs.
- Allows vault configuration and plugin data files to sync.
- Runs runtime checks automatically and simplifies the settings screen into sync, activity, and advanced pages.

## 0.1.0

- Initial Light-LiveSync release.
- Adds guided CouchDB setup, setup URI import, and add-device URI generation.
- Requires encrypted sync by default with local encrypted credential storage.
- Batches edits for low network use and uses periodic sync as a fallback.
- Includes automatic text merge, recovery backups, runtime checks, and release verification.
