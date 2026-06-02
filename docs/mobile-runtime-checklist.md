# Mobile Runtime Checklist

Use this checklist on a real iOS or Android Obsidian install before calling mobile support fully verified. Desktop browser API simulation is useful, but it is not a substitute for a mobile Obsidian runtime.

## Prepare The Release

On a desktop development machine:

```sh
npm install
npm run check
```

This creates `release/lightweight-livesync/` and `release/lightweight-livesync.zip`. The release folder must contain only:

- `manifest.json`
- `main.js`
- `sync-worker.js`
- `styles.css`

The automated gate also checks that source code avoids desktop-only Node/Electron APIs, that the manifest is not desktop-only, that runtime dependencies stay lightweight, and that the bundled worker has no runtime `require(...)`. This is still a preflight check, not a replacement for the mobile runtime test below.

## Install On Mobile

1. Copy the `lightweight-livesync` release folder into the mobile vault's `.obsidian/plugins/` folder.
2. Restart Obsidian mobile.
3. Enable **Lightweight LiveSync** in Community plugins.
4. Confirm the plugin appears as mobile-capable and does not report a desktop-only manifest.

## Connect As An Additional Device

Recommended secure flow:

1. On the already-configured original device, open Lightweight LiveSync settings.
2. Generate an add-device setup URI.
3. Transfer the URI to the mobile device through a trusted channel.
4. On mobile, import the setup URI and enter the shared E2EE passphrase.
5. Run the plugin's CouchDB connection check.

The mobile device should verify the existing database and sync parameters. It should not create the database or initialize sync parameters.

## Runtime Checks

Run these command-palette checks on mobile:

- `Lightweight LiveSync: Run desktop/mobile capability check`
- `Lightweight LiveSync: Run runtime smoke check`
- `Lightweight LiveSync: Run session unlock cache self-check`
- `Lightweight LiveSync: Write runtime evidence report`

Expected results:

- WebCrypto, IndexedDB, session storage, text/base64 codecs, and at least one CouchDB transport path are available.
- If workers are unavailable, the check still passes with the main-thread fallback path.
- Credentials remain locked until the local credential passphrase is entered.
- No raw CouchDB password or E2EE passphrase is saved in plugin data.
- The runtime evidence report is created in the vault and does not include CouchDB hostnames, database names, usernames, passwords, E2EE passphrases, setup URI contents, or local filesystem paths.

## Sync Smoke Test

1. Unlock credentials for the mobile session.
2. Create a small note on mobile.
3. Edit it several times within one minute.
4. Confirm the status remains calm while changes batch.
5. Run `Lightweight LiveSync: Sync now`, or wait for the next automatic batch.
6. Confirm the note appears on the original device.
7. Edit the same note on the original device.
8. Sync both devices and confirm the mobile note updates without manual conflict resolution.
9. Put the mobile device briefly on a poor or offline connection, edit a note, restore connectivity, and confirm the plugin resumes without repeated large transfers.
10. Run `Lightweight LiveSync: Write runtime evidence report` after the devices settle.

Pass criteria:

- Obsidian mobile remains responsive during startup, editing, batching, and sync.
- Status messages stay small and readable.
- Sync finishes without repeated failure notices.
- No queued local push or remote apply remains after both devices settle.
- Automatic text merge handles ordinary note edits without asking for manual conflict resolution.

## Evidence To Record

Record non-secret evidence only. Use `docs/mobile-evidence-template.md` as the capture format.

- Obsidian mobile version and platform.
- Plugin version.
- Runtime capability check result.
- Runtime smoke check result.
- Runtime evidence report result.
- Whether worker or fallback mode was used.
- Sync duration and queue counts after the smoke test.
- Any visible UI freeze, crash, or repeated retry loop.

Do not record CouchDB passwords, E2EE passphrases, setup URI contents, private server addresses, personal vault paths, or note contents.
