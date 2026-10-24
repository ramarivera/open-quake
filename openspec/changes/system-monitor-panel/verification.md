# System monitor panel acceptance

PR: https://github.com/ramarivera/open-quake/pull/30
Implementation commit: `a5854b94427f8a789b2fe3086d1e04788e825454`.
Base includes main `19d7240`, including profile management and device lifecycle.

Audit coverage: WIDGETS-064–083, AUDIT_WIDGETS §3.2 and F6/F7. Approved decisions
4/5 retain unavailable values and configurable default 1 Hz sampling.

## Repository gates

All passed after integration with main:

| Command | Result |
| --- | --- |
| `pnpm biome check packages apps` | 402 files checked |
| `pnpm typecheck` | Six workspace tasks passed |
| `pnpm test` | 891 tests across 92 files passed |
| `pnpm build` | Passed |
| `pnpm --filter @open-quake/desktop test:bundle` | Hermetic default-HID and explicit mock paths passed |
| `openspec validate --all --strict` | 35 changes passed |

Unit/property/TestClock coverage includes rate bounds, per-module isolation,
non-overlap, stale retained values, interruption, revision conflicts, failed
writes, invalid-settings recovery, media identity checks, permission/command
failure states, unsupported platforms and truthful readouts.

## Native mock acceptance

Both native monitor and required media smokes passed with hidden Electron
windows, `env -u ELECTRON_RUN_AS_NODE` and `OPEN_QUAKE_MOCK_DEVICE=1`.
The monitor smoke drives production preload/IPC and all five layouts, draft/Save,
fixture isolation, window permissions, raw mock-touch disk dragging,
contrast/reduced motion, missing image fallback, native video validation,
short-video rejection, muted looping playback, picker cancellation and sampling
cleanup on disable and last-window closure. The media smoke also verifies
wallpaper, lifecycle diagnostics, strip touch and narrow management layout.

Artifact root:
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/monitor-panel/`.

Logs: `gate-*.log`, `native-smoke.log`, `native-media-smoke.log`.
Five visually inspected captures, with PNG dimensions checked as 1920×480:

- `panel-glass-1920x480.png`
- `panel-cyber-1920x480.png`
- `panel-anime-1920x480.png`
- `panel-tactical-1920x480.png`
- `panel-wasteland-1920x480.png`

The local `REPORT.md` records the source findings, platform matrix and delivery.
The Wasteland process plate follows the recovered Vue's 780 px width; the audit
summary says 734. The existing padded 8×2 slot is preserved.

## Limits

No real QUAKE or touch HID was opened, and DK-Suite was never started. Physical
placement, USB delivery, firmware, touch direction, real display readability and
pixel identity with running DK-Suite remain unverified.

macOS uses Node os plus bounded shell-free df/ps/netstat/pmset commands. GPU
load/model and CPU/GPU temperatures are explicitly unsupported. Other hosts
provide CPU/memory only. No dependency was added. Settings use one local panel
record pending the per-key configuration editor. Built-in backgrounds use
original CSS textures; unreferenced staged media remains local. App/window
monitoring, Bluetooth tiles and monitoring override remain open in
system-monitor-tiles.
