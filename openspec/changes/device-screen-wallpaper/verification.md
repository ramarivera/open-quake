# W6 verification

Tasks 1.1–1.5 are complete. The remaining eleven tasks are open. Beads updates
belong to the parent under the shared lane brief; no `bd` commands were run.

## Acceptance evidence

- 1.1: all five decision headings in `design.md` record
  `Approved (Ramiro, 2026-10-23)`. The pending-decision prose is reconciled.
  `openspec validate device-screen-wallpaper` passes.
- 1.2: `packages/device/src/display/display.test.ts` validates settings fields,
  invalid modes/durations, asset references, resource targets, interval units,
  schema round trips and property-based geometry. No guessed full-panel key
  address is introduced. Unknown capability targets fail the pure predicate.
- 1.3: `apps/desktop/src/main/media/media-repository.test.ts` drives real temporary
  filesystem storage and controlled decoder/IO failures. It covers two serials,
  restart, removed original/managed assets, signature and decoder rejection,
  invalid settings, stale revisions, backup recovery and failed atomic writes
  at both the backup and primary rename. Errors retain the actual private cause
  and omit paths and tokens from serialization.
- 1.4: `apps/desktop/src/renderer/src/wallpaper/wallpaper.test.ts` drives the
  shared SVG renderer and decoded subscriptions. The native Electron smoke
  gate drives the production preload, IPC, repository and renderer in two
  hidden windows with actual nativeImage PNG/JPEG decoding. It verifies
  contain/cover/center, separate serials, the neutral initial state and unchanged
  `deviceDelivery: unverified`. Desktop and 390-pixel management captures were
  inspected. The narrow layout has no horizontal overflow. Live theme updates
  reach both windows; the light-theme neutral fill is `rgb(245, 247, 250)` and
  reduced-motion canvas animation count is zero.
- 1.5: `dkDesktopClock` is declared once in the display tile registry with
  exactly one validated hour-format action. Effect TestClock tests cover
  midnight rollover, one-second cadence and disposal. Formatting fixtures cover
  noon, midnight and 12h/24h. Both windows receive identical host-clock tick
  arrays in the Electron smoke gate. No firmware clock event is required.

## Commands and observed results

```text
pnpm install
PASS. No additional package versions downloaded. Existing peer warnings:
electron-vite 5.0.0 expects Vite <=7; workspace uses 8.2.2.
@effect/vitest 0.30.0 expects Vitest 3; workspace uses 4.1.11.

openspec validate device-screen-wallpaper
Change 'device-screen-wallpaper' is valid

pnpm run lint
Checked 92 files. No fixes applied.

pnpm run typecheck
6 successful package tasks

pnpm run test
3 successful package tasks
desktop: 10 files, 102 tests passed
device: 6 files, 61 tests passed
protocol: 2 files, 25 tests passed, Turbo cache replay

pnpm run build
1 successful desktop task; main, preload and renderer bundles built

pnpm --filter @open-quake/desktop exec electron-vite build --config src/main/media/smoke.config.ts
PASS. Smoke-only config intentionally omits renderer/preload; it uses their
production outputs from pnpm run build.

env -u ELECTRON_RUN_AS_NODE pnpm --filter @open-quake/desktop exec electron out/media-smoke/smoke.js /tmp/open-quake-w6-visuals
W6 Electron smoke PASS: native PNG/JPEG decoding, isolated serials, real
preload/IPC, three fill modes, synchronized one-second clock, light theme/reduced
motion, hidden panel/preview. Hardware unverified.
```

The collaborative preview returned `Preview automation snapshot timed out after
15000ms.` twice. Visual verification used hidden Electron windows and local
captures instead. Screenshots are local artifacts, not committed assets.

## Limits and parent handoff

No QUAKE hardware was accessed. Physical panel placement, A2 transfers, firmware
targets, chunk limits, timing, acknowledgments and full-panel resource delivery
remain unverified. Tasks 2.1–2.5 retain their explicit hardware gates. Tasks 3.x
and 4.x remain open; this change is not ready to archive.

Main creates the media runtime from `MediaLive` and calls `registerMedia` with
its current management-window getter. Media handling lives under `media/`;
shared display and IPC contracts live under `apps/desktop/src/shared/`.
Preload adds one import.
The only existing device-file edit is the display barrel export in `index.ts`.
App wiring replaces prototype panel counters with wallpaper/clock and adds the
management controls; management retains the mock device diagnostics.

The desktop declares `effect: catalog:` using the existing pinned 3.22.1
version. This new dependency declaration is listed under NEEDS APPROVAL in the
PR. No new image library or proprietary artwork is included.

Parent should close `open-quake-t81.1` through `open-quake-t81.5`, each with the
matching task evidence above and this OpenSpec path. Keep the parent epic and
all remaining task beads open.

## Review-fix round 1

The media bridge now authorizes mutations using the sending webContents and
main's current management-window identity. URL query parameters do not grant
permissions. `media-permissions.test.ts` and `media-registration.test.ts` reject
panel mutations with `?surface=management`, reject child-frame requests, and
verify the replacement management window receives authority after activation.
The native smoke gate repeats spoofed select/import/configure/clear/restore
requests through the production preload and IPC handler.

Settings saves stage primary and backup bytes before either rename. The primary
commits first; backup rotation happens afterward and rolls the primary back if
that rotation fails. Real-filesystem tests inject primary/backup write and rename
failures with revision 2 current and revision 1 backed up. Each failure preserves
both committed files, their asset references and private error cause. Restore
then returns revision 1's settings as revision 3, and temporary files are absent.

Assets now live under a serial-hash directory. Collection runs after a successful
settings commit under the same repository lock as import/save/restore. It retains
both current and backup references. Tests cover replacement, clearing, restore,
another serial using identical bytes, failed commits, invalid settings and cleanup
failure/retry. Original flat-layout assets remain readable; their collection
validates every serial's committed settings and preserves all referenced hashes.

Main, preload and renderer import shared display/IPC contracts directly. Main
has no renderer-source dependencies. Media registration has no import side
effects. Main supplies the exported Layer's runtime to the register function.
Clock interruption uses that runtime, and Electron waits for disposal before
quitting. Tests cover last-window closure, clock restart, runtime finalizers,
handler/listener cleanup and no post-disposal clock broadcasts. The native smoke
gate asserts the runtime finalizer has run before `will-quit`.

Observed gates for this round:

```text
pnpm install
PASS. Lockfile up to date; no new dependencies.

pnpm run lint
PASS. Checked 93 files; no fixes applied.

pnpm run typecheck
PASS. 6 successful package tasks.

pnpm run test
PASS. 3 successful package tasks.
desktop: 11 files, 110 tests passed.
device: 6 files, 61 tests passed, Turbo cache replay.
protocol: 2 files, 25 tests passed, Turbo cache replay.

pnpm run build
PASS. Main, preload and renderer production bundles built.

openspec validate device-screen-wallpaper
PASS. Change 'device-screen-wallpaper' is valid.

pnpm --filter @open-quake/desktop exec electron-vite build --config src/main/media/smoke.config.ts
PASS. Smoke entry built against production preload and renderer outputs.

env -u ELECTRON_RUN_AS_NODE pnpm --filter @open-quake/desktop exec electron out/media-smoke/smoke.js
W6 Electron smoke PASS: spoofed panel mutations rejected, native PNG/JPEG decoding,
isolated serials, real preload/IPC, three fill modes, synchronized one-second
clock, light theme/reduced motion, hidden panel/preview. Hardware unverified.
Media runtime disposal before will-quit PASS
```

The first full test run exposed the window-lifecycle fixture's missing explicit
media registration mock. Its fixture now verifies that main passes a getter for
the current management window, including after replacement. The rerun passed.
No additional Codex or CodeRabbit inline findings were present when checked.

The tracker comment requires no code change under the parent brief. The parent
closes `open-quake-t81.1` through `.5` at merge with this evidence. No direct `bd`
commands were run. Hardware-only acceptance and remaining tasks stay open.
