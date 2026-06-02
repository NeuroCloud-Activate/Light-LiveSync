# Mobile Evidence Template

Use this template after running `docs/mobile-runtime-checklist.md` on a real iOS or Android Obsidian install.

Do not paste setup URI contents, CouchDB passwords, E2EE passphrases, private server addresses, personal vault paths, or note contents into this file.

## Device

- Date:
- Tester:
- Platform: iOS / iPadOS / Android
- Device model:
- Obsidian mobile version:
- Lightweight LiveSync version:
- Install source: release folder / release zip / other

## Setup

- Device role: additional device / initial device
- Setup method: generated add-device URI / direct CouchDB setup
- CouchDB transport mode: standard fetch / Obsidian request API
- E2EE enabled: yes / no
- Path obfuscation enabled: yes / no
- Background worker reported available: yes / no
- Main-thread fallback reported available: yes / no

## Command Checks

| Check | Result | Non-secret notes |
| --- | --- | --- |
| Run desktop/mobile capability check | pass / fail | |
| Run runtime smoke check before unlock | pass / fail | |
| Run session unlock cache self-check | pass / fail | |
| Unlock credentials | pass / fail | |
| Run runtime smoke check after unlock | pass / fail | |
| Write runtime evidence report | pass / fail | |

## Sync Smoke Test

| Step | Result | Non-secret notes |
| --- | --- | --- |
| Create mobile test note | pass / fail | |
| Edit mobile note several times within one minute | pass / fail | |
| Status remains calm during batching | pass / fail | |
| Sync mobile to CouchDB | pass / fail | |
| Note appears on original device | pass / fail | |
| Edit same note on original device | pass / fail | |
| Sync original-to-mobile update | pass / fail | |
| Ordinary text merge completes without manual conflict prompt | pass / fail | |
| Poor/offline connection pauses or retries calmly | pass / fail | |
| Queues settle to zero pending push/apply | pass / fail | |

## Performance Notes

- Startup felt responsive: yes / no
- Editing felt responsive during batching: yes / no
- Sync caused visible UI freeze: yes / no
- Repeated failure notices or retry loop: yes / no
- Approximate sync duration shown by plugin:
- Queue counts after settling:
- Worker path or fallback path observed:
- Runtime evidence report created: yes / no
- Runtime evidence report excluded server/user/secret/local-path details: yes / no

## Outcome

- Mobile runtime sync result: pass / fail / inconclusive
- If failed or inconclusive, short non-secret reason:
- Follow-up issue needed:
