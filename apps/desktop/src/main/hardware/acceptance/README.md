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
again. Restoration consumes each setting acknowledgement before sending its query.
Its independent reply waits have a four-second deadline and retain catalog timeout identity.
Restoration runs on failure and interruption too. A restoration failure
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
the base revision, dirty working-tree status and a SHA256 of the actual suite source, so uncommitted suite
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
an interactive terminal confirmation after a fresh local readiness acknowledgement.
It generates a new challenge for every invocation and accepts it for 30 seconds.
Inherited environment readiness flags cannot authorize a run.
It opens a dedicated window, checks that window owns focus, types one letter
through the actual hardware keyboard path, checks its key release, then closes.
Its own Chromium helper processes are excluded from competing HID owners; independent
Electron applications remain blocked. Electron stays alive for runtime, diagnostics and
owner cleanup, and only then finalizes the passed result.
No physical cursor movement or shortcuts occur. Do not run it
for unattended or background-only tests. Its separate `keyboard-result.json`
is supplemental evidence; the control-suite percentage does not silently count
an unexecuted supervised test as passed.


## Supplemental native tests

Set `OPEN_QUAKE_HW_E2E_EXTENDED=1` alongside the native opt-in, exact serial and a fresh artifact directory, then run `pnpm test:hardware`. Mutation mode is still separate. The supplemental result preserves ten fixed checks, including skips, without changing the original twenty-scenario denominator. It exercises twelve concurrent production query operations, twelve software reconnect cycles, stale-owner rejection and complete handle cleanup.

Legacy lighting round trips require the existing qualified firmware identity. Installed QUAKE:3:1.0.19/protocol12 now exposes only hardware-qualified effect speed through the production shared-owner LightingService. The service maps speed to channel3/value3, verifies actual readback and never opens a second handle. Supplemental probes inspect channel3 values1-4; only effect speed has verified exact application and restoration. Brightness, color and effect writes are blocked in the repeatable suite. Qualification experiments found nontrivial brightness readback mapping, and restored its original247/off0 state; an echoed write is not proof of application. No lighting flash-save command is permitted. The renderer receives save availability and disables save for this V3 profile. Other firmware/protocol identities do not inherit this qualification.

`audio-smoke.ts`, built with `audio-smoke.config.ts`, additionally requires `OPEN_QUAKE_HW_E2E_AUDIO=1` and existing native microphone permission. It records two brief sessions from the default USB PnP input, validates PCM sequencing, pause/resume, stop/tail drainage and worker cleanup, then plays a low-level250ms tone through the production audio output. Results retain counts and RMS only, not audio samples. Native playback completion does not prove acoustic audibility or a provider loop. Raw hardware gestures, USB cable hot-plug and physical illumination remain separate acceptance items.
