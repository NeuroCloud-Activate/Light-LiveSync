# Changelog

## 0.1.50

- Speeds up startup sync by replacing full local-cache summary scans with IndexedDB counts.
- Adds local indexes for pending remote apply items so large cached CouchDB histories do not delay the first server check.
- Lets foreground and startup CouchDB checks run before slower configuration fallback scans, then queues any discovered config uploads afterward.
- Deduplicates overlapping configuration fallback scans and prioritizes newer local uploads ahead of older unchanged queue entries.
- Reduces the default local edit batching window to 2 seconds for faster small-file sync.

## 0.1.49

- Cleans up an Obsidian source review warning by using a typed own-property check in the plugin manager refresh path.

## 0.1.48

- Stops synced plugin settings files from forcing automatic community-plugin reloads on mobile.
- Keeps automatic plugin reloads for actual plugin asset updates such as manifests, JavaScript bundles, and CSS files.

## 0.1.47

- Fixes multi-chunk binary reconstruction so PDFs and other large attachments are decoded chunk-by-chunk before being written to the vault.
- Makes large binary upload preparation yield during chunk creation, reducing app pauses when attachments are prepared on the main thread.
- Filters recently changed configuration/plugin fallback scans before queueing uploads, so unchanged files are skipped earlier and startup queues stay smaller.

## 0.1.46

- Lowers normal desktop CouchDB checkpoint polling to 15 seconds to improve cross-device pickup time.
- Keeps the faster polling lightweight by throttling periodic configuration-folder fallback scans separately, so regular remote checks do not repeatedly walk plugin/settings files.
- Keeps startup and foreground config scans responsive while relying on vault events, fingerprints, and in-memory snapshots for changed-file uploads.
- Cleans up Obsidian review warnings around typed JSON parsing, plugin-manager key checks, and mobile stylesheet compatibility.

## 0.1.45

- Reworks upload chunk splitting without lookbehind regular expressions so older iOS WebKit versions can load the plugin.
- Uses Obsidian platform/window/document APIs for runtime checks, settings refreshes, and foreground sync detection.
- Routes CouchDB traffic through Obsidian's request API and cleans up review warnings around base64, IndexedDB, path sanitizing, and setup URI encryption.

## 0.1.44

- Defers synced community-plugin enablement and plugin reloads until after Obsidian has finished its startup layout work.
- Retries synced plugin refresh when Obsidian has not discovered a plugin manifest yet, avoiding launch-time load races.
- Recovers enabled-but-not-loaded synced plugins by using Obsidian's enable action after startup instead of forcing an early reload.

## 0.1.43

- Keeps normal CouchDB inspections metadata-only, avoiding the extra recent-document sample download during routine sync checks.
- Continues to pull remote updates through the saved CouchDB checkpoint, so downloads ask only for documents changed since the last successful pull.
- Keeps the first-sync empty-remote guard intact by sampling recent changes only when no local checkpoint exists and the plugin needs that decision.
- Preserves existing remote sample counters in settings when an inspection intentionally skips recent-change sampling.

## 0.1.42

- Refreshes Obsidian community plugin enablement after synced `community-plugins.json` changes are applied.
- Reloads affected enabled community plugins after synced plugin manifests, bundles, or settings files change.
- Tracks actual changed vault paths during remote apply, so refresh work only runs for config/plugin files that were really written or deleted.
- Notifies the workspace when synced app-level JSON settings are applied, while keeping Light-LiveSync itself from self-reloading mid-sync.

## 0.1.41

- Requests startup sync before the startup configuration scan, so app-open CouchDB catch-up begins immediately.
- Starts vault-change sync as soon as the batching window ends instead of waiting behind the normal scheduler throttle.
- Avoids extra full local summary scans during quiet CouchDB checks where no remote changes are returned.
- Caches remote change batches without repeated summary refreshes, keeping larger pull pages lighter while still yielding between local cache batches.
- Defers sync-start diagnostics persistence briefly so startup sync work is not competing with an immediate settings write.

## 0.1.40

- Requests startup sync immediately after the vault layout is ready, then runs the automatic runtime check after sync has had a chance to start.
- Uses local file metadata plus the local sync fingerprint index to skip unchanged files before they are queued during full-vault scans.
- Adds a small RAM snapshot cache so files that do need verification or upload are not reread repeatedly during the same sync pass.
- Coalesces queue/progress state saves during active sync, reducing plugin data writes that can briefly compete with the app UI.

## 0.1.39

- Reduces default local-change batching from 60 seconds to 10 seconds and migrates older default installs to the faster setting.
- Lets immediate startup, setup, foreground, and manual sync requests preempt delayed scheduled checks so app-open catch-up starts right away.
- Uploads recently changed `.obsidian` configuration and community plugin files quickly, including `community-plugins.json` and installed plugin bundles that may not emit normal vault events.

## 0.1.38

- Moves the setup URI passphrase field above the setup URI block so iPhone keyboards do not cover the field during add-device setup.
- Collapses an already-loaded setup URI behind an edit action, preventing long encrypted links from filling the mobile setup window.
- Tracks the mobile visual viewport while setup fields are focused and scrolls the active field back into view after the iOS keyboard opens.

## 0.1.37

- Makes setup, credential, and add-device modals scrollable and keyboard-safe on iPhone and iPadOS windowed layouts.
- Adds mobile-friendly sizing for setup URI text areas so paste fields remain reachable when the on-screen keyboard is open.
- Keeps setup URI, CouchDB credential, and passphrase fields from autocapitalizing, spellchecking, or browser/autofill rewriting pasted secrets.

## 0.1.36

- Pulls the existing remote vault before doing a full local scan on a freshly added additional device, preventing blank local plugin settings from uploading first.
- Queues locally preserved API keys, tokens, credentials, auth fields, and command lists for repair upload when a remote settings merge would otherwise blank them.
- Continues the sync loop automatically when a remote apply creates a repaired settings upload, so the corrected settings can flow back to CouchDB without another manual step.

## 0.1.35

- Applies Obsidian JSON settings files with a structured JSON merge instead of line-based text merging.
- Preserves non-empty local API keys, tokens, passwords, credentials, auth fields, and command lists when another device sends blank values.
- Keeps normal JSON setting updates flowing across devices, so plugin settings still sync without wiping local secrets or custom command lists.

## 0.1.34

- Treats startup catch-up pages with an existing CouchDB checkpoint like lightweight checkpoint pulls, avoiding repeated full server inspection during new-device catch-up.
- Keeps full startup inspection at checkpoint `0`, so first-run remote validation and empty-remote first-vault upload detection still run normally.
- Adds harness coverage for startup catch-up from an existing CouchDB checkpoint.

## 0.1.33

- Clarifies sync-finish wording so local pending uploads/apply items are separate from remote CouchDB catch-up pages.
- Runs automatic continuation passes immediately after a successful progress-making pass, so new-device/full catch-up pages do not wait behind the normal sync throttle.
- Adds harness coverage for full remote pull pages and immediate continuation despite the normal minimum sync interval.

## 0.1.32

- Makes idle periodic polling lighter by reusing the saved, already-validated CouchDB setup and pulling from the local checkpoint directly when there are no local uploads waiting.
- Keeps full remote inspection for manual sync, startup sync, setup import, vault-change sync, first-vault uploads, queued local uploads, and missing sync-parameter salt cases.
- Adds sync-engine coverage proving lightweight periodic checks still advance CouchDB checkpoints and that incomplete setup still uses the full verification path.

## 0.1.31

- Queues Obsidian vault-change events directly instead of dropping edits when a platform reports an older file timestamp.
- Adds an Activity log entry when the first local edit or delete in a batch is noticed, making missed desktop uploads easier to diagnose.
- Applies remote text deletions during automatic merge, including inline text removals and deleted lines.
- Adds a Recently deleted files view in Recovery for restoring deleted files from saved encrypted version history.

## 0.1.30

- Caps normal automatic remote checks at 30 seconds for faster cross-device pickup without constant network chatter.
- Uses a 15-second remote check cadence while a mobile device is foregrounded, so iPad catches desktop edits sooner when the app is open.
- Keeps local edit uploads, retries, and non-periodic syncs on their existing sync throttle while allowing faster remote-check polling.
- Caps imported setup URI and QR remote-check intervals to the same 30-second normal maximum.

## 0.1.29

- Reduces the default automatic remote check interval from five minutes to one minute so other devices pick up uploaded edits much sooner.
- Migrates existing installs that still use the old five-minute fallback interval to the new one-minute remote check interval.
- Adds foreground and visibility-change remote checks so mobile devices catch up when the app becomes active again.
- Renames the advanced interval setting to clarify that it controls automatic CouchDB checks for changes from other devices.

## 0.1.28

- Prefetches missing content chunks once per apply batch before reconstructing files, reducing repeated CouchDB chunk recovery on Windows.
- Keeps Activity logs calmer by collapsing many one-file chunk recovery calls into batch recovery during remote apply backlogs.
- Preserves the existing automatic continuation behavior while old local apply backlogs drain in bounded file batches.

## 0.1.27

- Stops repeated mobile re-downloads by saving CouchDB's returned checkpoint after every successful pull window.
- Keeps already-applied remote files marked applied when the same CouchDB document revision is replayed.
- Reduces each CouchDB pull window from 1000 to 250 document changes while still caching internally in smaller batches.
- Adds clearer Activity log checkpoint details so repeated polling can be diagnosed without a noisy status bar.

## 0.1.26

- Prevents malformed remote binary content from stopping startup sync by treating invalid base64 as a per-file unsupported apply item.
- Accepts standard base64, URL-safe base64, and missing-padding base64 when reconstructing synced binary files.
- Reports corrupt remote binary content in Activity skipped/failed details instead of surfacing a raw browser `atob` error.

## 0.1.25

- Groups prepared local file uploads into larger CouchDB bulk writes to reduce mobile request overhead while keeping per-file retry isolation if a grouped upload fails.
- Uses Obsidian's request transport by default for better iPadOS/mobile network compatibility, with standard fetch still available as an advanced fallback.
- Raises remote pull pages and cache batches modestly, and stops automatic continuation once the current CouchDB checkpoint has been reached.
- Clarifies sync results as remote document changes rather than files, since CouchDB changes include file, chunk, version, and system documents.

## 0.1.24

- Embeds the sync worker source inside `main.js` so mobile installs can start the worker even when `sync-worker.js` is not readable from the plugin folder.
- Uses the embedded worker source as a quiet fallback before falling back to the cooperative main-thread push builder.
- Updates mobile and release checks to verify the embedded worker fallback remains present.

## 0.1.23

- Repairs pending remote files whose chunk records are missing from the local apply cache by fetching those referenced chunks directly from CouchDB.
- Caches repaired chunk records locally so queued remote applies can finish without waiting for old chunk changes to reappear in the changes feed.
- Logs how many missing content chunks were recovered and whether any referenced chunks are still absent on the server.

## 0.1.22

- Clears excluded remote apply records before missing chunks can leave them waiting.
- Continues automatic sync passes while remote apply cleanup is making progress, then stops when only genuinely incomplete files remain.
- Raises the default remote file apply batch from 25 to 50 files per pass and upgrades older default installs automatically.

## 0.1.21

- Excludes copied Light-LiveSync source folders and common development folders from vault sync and remote apply.
- Applies hidden/config files through the vault adapter when Obsidian's normal file lookup does not expose them, avoiding `File already exists` apply failures.
- Automatically marks excluded remote apply records resolved with a plain-language Activity log reason.

## 0.1.20

- Improves automatic remote apply resolution so terminal skipped items are marked resolved instead of repeating forever.
- Keeps genuinely incomplete remote files waiting only when they still need missing chunks or usable decryption.
- Adds plain-language Activity log details for waiting, skipped, and failed remote apply items.
- Keeps automatic text merge as the normal conflict-resolution path before remote items are marked applied.

## 0.1.19

- Refines the Recovery tab so the file location is a dedicated autocomplete search field above the version lookup actions.
- Removes the separate recovery-backup browser from the Recovery tab to keep recovery focused on previous synced versions.
- Keeps automatic local safety backups in place before version restores or remote overwrites.

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
