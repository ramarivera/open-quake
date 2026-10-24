# System monitor panel verification and pending acceptance

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


## PR #30 review round 1

The seven fetched review threads were verified against source. Both power-source
threads identify the same defect. The fix carries AC/battery source independently
from charging, charged, not-charging or discharging state. A confirmed absent
battery and every missing numeric readout omit their units. Parser output reaches
all five rendered styles in regression tests. This corrects the recovered model's
presence-based inference under approved decision 4, WIDGETS-077/083.

Failed attempts retain the previous successful sample's values and timestamp.
The sampler exposes the latest failure before expiry, labels the retained value
stale after three intervals and replaces it on recovery. A TestClock regression
covers successive errors, permission failures, unavailable attempts and recovery.
External IPv6-only interfaces now supply link counters and rates.

Settings reads return only the active custom style's media. Hidden slots remain
metadata; management requests another saved style only for its draft preview.
The 32 MiB video regression verifies one media read with all five slots populated,
no media reads for sampling configuration, and preserved slots after Save. Native
IPC exercises saved multi-style video switching without leaking the draft.

Only the main-owned panel's top frame may subscribe. Main-owned management and
panel documents alone receive settings broadcasts. Native thumbnail and spoofed
panel windows fail monitor reads/subscriptions and receive no settings or metrics.
The smoke fixture gives the separate thumbnail manager an explicit unavailable
reply; the production monitor and preload run unchanged in that test.

Fresh gates all passed on the final source:

- `pnpm biome check packages apps`, 402 files.
- `pnpm typecheck`, six workspace tasks.
- `pnpm test`, 903 tests across 92 files: protocol 47, device 388, edge 30, desktop 438.
- `pnpm build`.
- `pnpm --filter @open-quake/desktop test:bundle`, default-HID and explicit mock paths without hardware I/O.
- `openspec validate --all --strict`, 35 changes.

Native monitor and baseline media smokes passed with mock mode, hidden windows,
and ELECTRON_RUN_AS_NODE removed. Fresh five-style 1920x480 captures were visually
inspected and their PNG dimensions checked. Evidence is under
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/monitor-panel/`:
`review-round-1-gate-*.log`, `review-round-1-focused.log`,
`review-round-1-retention.log`, and `review-round-1/` for both native smoke logs,
the five panel captures and baseline captures. Regressions failed against the
original sampler, parser, store and renderer; the IPv4-only predicate also fails
its new regression. Those logs are `review-round-1-*-original-red.log`.

`git merge origin/main` reported Already up to date. Main `19d7240` remains an
ancestor, preserving the integrated profile and lifecycle features. No dependency
was added. No real HID or DK-Suite was opened. Platform and hardware limits above
remain. Cluster open-quake-lih.8 and epic open-quake-lih.8.1 are reopened pending
merge and lead acceptance. Original implementation tasks remain closed. Review
follow-through is tracked by open-quake-lih.8.1.5 until the pushed fix has been
replied to and addressed threads resolved.
