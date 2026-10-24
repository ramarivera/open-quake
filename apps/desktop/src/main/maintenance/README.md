# Desktop maintenance

Settings provides manual firmware updates, encrypted backup/restore, clear-data
and exit, five macOS permission checks, and an app-update state machine. The
main process owns operations; closing a dialog never cancels a firmware write.
Schemas live in `packages/edge/src/maintenance/contracts.ts`. Desktop uses the
existing authenticated preload/IPC pattern. Hardware writes stay in device;
UF2 inspection stays pure in protocol. Each boundary returns catalog errors
with private causes and scrubbed diagnostics.

## Firmware

SETTINGS-020 and SETTINGS-034..048 are implemented with these deliberate limits:

- The user selects a local UF2. No vendor binary is bundled or downloaded.
- Every block needs the exact standard UF2 magics, RP2040 family, consistent
  block numbering/counts and non-overlapping aligned payloads. A compiled
  trusted descriptor must also bind SHA-256, QUAKE board, version and range.
  The audited 1.0.21 descriptor covers `0x12000..0x6e7ff` only for its known hash.
- Separate native confirmations guard DFU and writing. Selection races reject
  before DFU. Device commands, previews and keepalive stop after DFU.
- Discovery recognizes `QUAKE DFU` with QUAKE bootloader metadata and mount
  identity. Multiple candidates require a choice showing the drive letter or full mount path;
  native write confirmation repeats the chosen path and intended serial. macOS asks for scoped access;
  remembered bookmarks never authorize a copy. Windows label lookup is cached
  for 5s and refreshed before writing.
- Discovery polls every 500ms for 90s. Writing settles 2500ms and revalidates
  image/mount before one exclusive copy. There are no overwrite fallback tools
  or automatic retries after a possible partial flash.
- Completion requires a fresh typed [2E] query of the intended serial, every
  2s with a 3s query limit for 90s. Copying or a vanished drive cannot succeed.
- A scrubbed persisted nonterminal session becomes `needs_recovery` on restart.
  Terminal snapshots expire after 10 minutes. The four-step 520px dialog uses
  recovered English strings and honors reduced motion. A new document restores
  an active dialog; closing it keeps the operation alive and terminal toasts
  last 6s.

After interruption or write failure, manually enter the intended device's known
bootloader and inspect the trusted image again. Bootloader recovery requires its
exact serial and a native confirmation before discovery, followed by a separate
write confirmation and all image/mount revalidation. It needs no live normal HID
session and sends no DFU command. Only that serial's expected version readback
can finish recovery. No rollback is offered. Do not disconnect power during copy.
Bootloader metadata, actual firmware writing and reconnection still require
supervised physical acceptance by the hardware owner.

## Backup, restore and reset

SETTINGS-014 uses authenticated WinZip AES-256 ZIP with deflate level 9,
`export_index.json`, an encrypted `<account>_config.json`, and the legacy
`app/assets/resources.conf` projection. `backup-archive.ts` documents the static
app-format password derivation without embedding a plain full password constant.
It provides compatibility, not a user-secret security boundary. Never log it.
`account-config.ts` implements electron-store 7/conf 9's inner AES-CBC envelope.

`@zip.js/zip.js@2.24.0` is pinned because Node crypto/zlib do not provide bounded
ZIP metadata parsing, WinZip AES framing or authenticated archive handling.
Node crypto supplies the inner account encryption and independent fixtures;
Node zlib supplies independent ZIP fixture compression.

Imports authenticate all entries before mutation and reject unsafe paths,
Windows aliases/streams, symlinks, duplicates, overlapping ZIP data and size
limit violations. Limits are 128 MiB compressed, 256 MiB uncompressed, 32 MiB per
entry and 8192 entries. They skip deleted/built-in resources and unchanged
complete ordered profiles, retaining repeated pages and including resolved
referenced asset content in their identity, merge unique profiles, remap IDs, preserve knob data and profile names,
and materialize referenced archived files. Paths are rebased across platforms;
missing archived paths reject the merge. Raster icons become inline images.
Unknown profile actions remain inert under the profile compatibility contract.
Content-based legacy asset directories preserve retained profiles when another
backup reuses a path with different bytes. Native profile IDs are checked for
collisions independently from content deduplication.

Native managed settings are included under `open-quake/`; credentials, account
sessions and transient files are excluded. Import clones userData to a sibling
staging directory and switches roots with rollback after writers stop. Only
allowlisted managed names can be restored; symlink destinations are rejected.
Monitor settings and custom media under `monitor-v1` are included. Its record
uses the monitor owner's Schema; its incomplete `settings.json.new` is excluded.
Successful import exits so cached writers cannot overwrite restored state.
Merge validation runs before shutdown and repeats after writers stop. A failure
after shutdown begins is reported by main, which then exits with failure status.
Export reads the actual renderer appearance localStorage through its owned
window and validates it with the appearance parser. Restore stages that record
for the real appearance hook, then removes it only after localStorage persistence
is acknowledged. Theme choice, custom colors and motion preference all travel.
Confirmed backup replacement uses a temporary sibling and atomic rename, keeping
the previous archive intact on export/write failure.
Format interoperability is proved with independent fixtures, not a real user's
DK-Suite backup or a DK-Suite process.

Reset offers backup first with a 60s deadline. Backup cancellation/failure needs
a second confirmation. Writer shutdown must succeed before removing the captured
app-owned userData root and exiting. No path is supplied by the renderer.

## Permissions and app updates

SETTINGS-015 refreshes Accessibility, Input Monitoring, Microphone, Screen
Recording and System Audio Recording on focus and every 2s. Status reads never
request permission. Fixed privacy deep links open only on a user action.
`koffi@3.3.3` is pinned for in-process CoreGraphics Input Monitoring and private
TCC System Audio preflight, which Electron does not expose. Missing APIs remain
unknown; registration is never interpreted as a grant. Native loading passed
under Electron 43.4.1; actual permission attribution and packaged signing remain
acceptance work. Only fixed paths/signatures load; IPC cannot choose a library.

SETTINGS-049/050 uses an owned `AppUpdatePort`, disabled in production. No real
endpoint or vendor OTA feed is wired. Fake-feed TestClock tests exercise the
5s first check and 12h cadence, single-flight background download, manual checks,
defer, install and disposal. Before enabling a release adapter, define a signed
or pinned open-quake manifest binding app id, semantic version, platform,
architecture, HTTPS artifact URL, byte length and SHA-256. The adapter must verify
those bytes before install and implement packaged installer handling. Scheduling
and state are implemented; real release publishing and installation are not.

## Verification

All hardware/file adapters in tests are fake. Set TMPDIR to lane scratch before
checks that create fixtures. Never select a real boot volume or enable real HID
for a test or smoke run.

```sh
export TMPDIR=/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/settings-firmware
pnpm biome check packages apps
TURBO_ENV_MODE=loose pnpm exec turbo run typecheck --force --concurrency=2
TURBO_ENV_MODE=loose pnpm exec turbo run test --force --concurrency=1 -- --maxWorkers=2
pnpm build
pnpm --filter @open-quake/desktop test:bundle
openspec validate --all --strict
pnpm --filter @open-quake/desktop exec electron-vite build --config src/main/maintenance/smoke.config.ts
env -u ELECTRON_RUN_AS_NODE OPEN_QUAKE_MOCK_DEVICE=1 pnpm --filter @open-quake/desktop exec electron out/maintenance-smoke/smoke.js "$TMPDIR"
```

The native smoke checks real preload/IPC, window spoof rejection, independently
decoded AES export, cancelled DFU/write confirmations, restored and closed
dialogs, a synthetic UF2 copy into scratch, intended-version re-read, native FFI
symbol loading and dark/light/narrow screenshots. It registers the production
maintenance, monitor, clock, media, profile, lifecycle, hardware and knob owners
together, using mock hardware, synthetic metrics and non-prompting display ports.
It checks profile/lifecycle reads, monitor save and panel-only metric delivery,
subscription shutdown, monitor archive inclusion, combined clock/monitor controls
and awaited disposal. `combined-screen-monitor.png` captures the integrated
Screen page. The main lifecycle tests also check monitor ownership and disposal
before quit; the shared shutdown promise stops monitor before reset or restore.
The smoke also drives the recovery serial field and confirmation cancellation,
verifies offline firmware stays unknown, waits for the real dialog's ready state,
and proves copy alone cannot complete recovery. `firmware-recovery-ready.png`
and `firmware-recovery-success.png` capture that path. Appearance restoration,
confirmed archive replacement and invalid-import preflight use the actual IPC
and renderer consumers. Post-shutdown failure/exit and collision regressions
have deterministic unit coverage in this directory.
The smoke has a 45s deadline and
removes its userData directory/disposes all runtimes before exiting. The original
media smoke in `../media/README.md` is also required for renderer changes.

Source inputs are local-only under
`/Users/ramarivera/dev/dark-encyclopedia/dk-suite-introspeccion/v0.4.95/`:
`audit/AUDIT_SETTINGS.md`, recovered settings/firmware components and English
locales; `app-resources/background.js` at bytes 6595513/6603890 for ZIP,
6471708 for encrypted account/profile merging, and 364307 for permission checks.
No research binaries or recovered application code are bundled.

PR #32 round 2 adds deterministic profile/page and referenced-content regressions,
initial and worker persistence-failure coverage, and fake Windows drive discovery.
The combined native mock presents two scratch drives, checks their mounted button
labels, clicks one and verifies its path and intended serial in the native
confirmation before cancelling. Firmware drive paths wrap inside the dialog.
