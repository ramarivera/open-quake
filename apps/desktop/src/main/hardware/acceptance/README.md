# Hardware E2E acceptance

This is an opt-in native control/session suite for the Mac mini acceptance host. Ordinary `pnpm test` only runs
`acceptance.test.ts` against fake HID. The native file is selected only by
`hardware.e2e.config.ts`; it requires explicit opt-in and an exact canonical
serial. It uses the production native transport, device service, hardware
controls, Effect runtime and private Pino diagnostics.

There are 20 named scenarios in `scenarios.ts`. Thirteen are automated. Seven
require physical or supervised acceptance: touch, knob gestures, physical hot-plug, panel visuals,
keyboard output, audio/provider behavior and lighting qualification. This is
coverage of that bounded inventory, not all application features or source lines.
Fake passes always contribute zero to the native percentage. Skips and supervised
checks stay in the denominator.

The read-only run sends only reviewed queries, QMK protocol-version requests
and production keepalives. It tests identity, open, firmware, mic/luminance
readback, QMK protocol, keepalive plus subsequent live readback, close, stale
write rejection and reopen. It doesn't establish firmware watchdog expiry.

The separately opted-in mutation run also changes microphone, panel luminance
and knob LED, queries the changed state, restores the original value and queries
again. Restoration runs on failure and interruption too. A restoration failure
is a failed scenario and retains the original failure as well. Product preferences
are never loaded or written; this suite uses memory-only preferences.

Before running, stop other open-quake and DK-Suite instances. The runner checks
process ownership and acquires an exclusive host-local lock. It refuses raw
firmware, keyboard, audio and screen-power commands even in mutation mode.
Never remove the lock while its process is running. No firmware flashing occurs.
Use a fresh output directory for every run; an existing result file fails closed
before hardware is opened, and interrupted runs leave an incomplete result. Finalization validates retained diagnostics
before atomically replacing that result; a result symlink cannot redirect the write.
The lock coordinates cooperating runs, not hostile processes with the same filesystem access.
Cleanup preserves a lock whose file identity has changed. Device serial selection is
rechecked against each connect or reconnect discovery before opening the transport.
The exact output directory must be inside the host's hardware E2E scratch root.

From `apps/desktop`, set these environment values in your launcher:

| Variable | Required value |
| --- | --- |
| `OPEN_QUAKE_HW_E2E` | `1` |
| `OPEN_QUAKE_HW_E2E_SERIAL` | Exact canonical serial, without colons |
| `OPEN_QUAKE_HW_E2E_ARTIFACTS` | Absolute child of `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-hardware-e2e/` |
| `OPEN_QUAKE_HW_E2E_MUTATIONS` | Optional `1`, permits the three reversible setting checks |

Then run `pnpm test:hardware`.
The run lasts roughly 20 seconds, with a 90-second test ceiling. Results include
the base revision and a SHA256 of the actual suite source, so uncommitted suite
execution is distinguishable from a committed version. `result.json` lists every
scenario; `diagnostics/` retains safe operation spans and causes. Neither report
prints the serial, native path or arbitrary exception messages. Trace identity
and zero drops/storage failures are checked before a run passes.

Native protocol readback establishes returned values and restoration, not whether
an LED looks correct or a microphone actually captures sound. Physical USB
hot-plug differs from a software disconnect/reopen. A current native run doesn't
validate an older signed download, and these control tests don't cover live
providers or OS input. Those phases need their own bounded readiness sequence.

## Supervised keyboard fixture

`keyboard-smoke.ts` builds with `keyboard-smoke.config.ts` and is not run by
ordinary tests. It requires the same native opt-in and ownership lock plus
`OPEN_QUAKE_HW_E2E_KEYBOARD_READY=1` after a fresh local readiness acknowledgement.
It opens a dedicated window, checks that window owns focus, types one letter
through the actual hardware keyboard path, checks its key release, then closes.
No physical cursor movement or shortcuts occur. Do not set that readiness flag
for unattended or background-only runs. Its separate `keyboard-result.json`
is supplemental evidence; the control-suite percentage does not silently count
an unexecuted supervised test as passed.
