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

Legacy lighting round trips require the existing qualified firmware identity. Installed QUAKE:3:1.0.19/protocol 12 now exposes only hardware-qualified effect speed through the production shared-owner LightingService. The service maps speed to channel 3/value 3, verifies actual readback and never opens a second handle. Supplemental probes inspect channel 3 values 1-4; only effect speed has verified exact application and restoration. Brightness, color and effect writes are blocked in the repeatable suite. Qualification experiments found nontrivial brightness readback mapping, and restored its original 247/off 0 state; an echoed write is not proof of application. No lighting flash-save command is permitted. The renderer receives save availability and disables save for this V3 profile. Other firmware/protocol identities do not inherit this qualification.

`audio-smoke.ts`, built with `audio-smoke.config.ts`, additionally requires `OPEN_QUAKE_HW_E2E_AUDIO=1` and existing native microphone permission. It records two brief sessions from the default USB PnP input, validates PCM sequencing, pause/resume, stop/tail drainage and worker cleanup, then plays a low-level 250 ms tone through the production audio output. Results retain counts and RMS only, not audio samples. Native playback completion does not prove acoustic audibility or a provider loop. Raw hardware gestures, USB cable hot-plug and physical illumination remain separate acceptance items.

Baseline control coverage and supplemental checks use separate runs and fresh artifact directories. Extended mode leaves baseline `scenarios` empty and does not recompute its percentage. The audio fixture proves transport/framing and records RMS; silence is valid input and is not proof of acoustic sensitivity. The fingerprint `fixtureBundleSha256` identifies the executed bundle, with checkout revision and dirty status recorded separately. The deadline cancels work, attempts bounded worker cleanup and releases the owner lock before forced exit. Partial-tail coverage requires at least one actual short final frame. Frame-aligned stops remain valid capture results and report partial-tail coverage as unexercised; they do not prevent independent playback checks.

## Panel display fixture

`panel-display.ts` builds with `panel-display.config.ts` after `pnpm build`, so
the composition root finds the production renderer and preload. It requires the
same native opt-in, artifact directory and ownership lock. It starts the actual
production app against the real device with memory-free scratch `userData`,
keeps management and settings windows hidden and unfocused, and lets only the
panel appear, inactive, on the QUAKE display.

Before startup it captures the QUAKE display with `screencapture -R`. Once the
panel fills that display it captures the display again and the panel's own
rendered page. It passes only when the display matches the rendered panel,
differs from the desktop it replaced and isn't a flat frame. `panel-result.json`
records the pixel evidence and tile counts; `desktop.png`, `display.png` and
`panel.png` stay in scratch.

Attach only the selected QUAKE: the production bus opens every attached
device, so the fixture refuses to start when any other QUAKE is present.

From `apps/desktop`, build once:

```bash
pnpm build
pnpm exec electron-vite build -c src/main/hardware/acceptance/panel-display.config.ts
```

Then run Electron from a script file rather than an inline shell command. The
owner check treats any process whose command line names both Electron and an
`oq-` checkout as a competing owner, including the launching shell:

```bash
#!/bin/bash
# run-panel.sh <fresh-run-name>, kept outside the repository
cd /path/to/open-quake/apps/desktop || exit 2
unset ELECTRON_RUN_AS_NODE
export OPEN_QUAKE_HW_E2E=1 OPEN_QUAKE_HW_E2E_SERIAL="<serial>" \
	OPEN_QUAKE_HW_E2E_ARTIFACTS="/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-hardware-e2e/$1"
exec ./node_modules/.bin/electron out/panel-display/panel-display.js
```

This is supplemental evidence for the `display` scenario, which stays
supervised. It shows what macOS sends to the QUAKE, not the backlight or the
light the panel physically emits.

## Query probe

Set `OPEN_QUAKE_HW_E2E_PROBE=1` with the native opt-in, exact serial and a fresh
artifact directory, then run `pnpm test:hardware`. It can't be combined with
extended or mutation mode. Its own allowlist permits only flag-2 queries: the
existing microphone, luminance, firmware and keep-alive reads plus seven
query-only commands from the reconstructed firmware: 0x02, 0x04 screen power,
0x06, 0x07 idle flags, 0x1E, 0x1F name and 0x2D tick. Set commands, key
injection, GPIO, firmware upload and DFU are refused before they reach the
handle.

The probe records every query reply, checks that keep-alive counts are
consecutive and measures the gap between keep-alives with the device's own
clock. It then sends nothing for 40 seconds and compares screen power, idle
flags and the keep-alive count before and after. Override the gap with
`OPEN_QUAKE_HW_E2E_STARVATION_MS`, up to 40000.

On QUAKE:3:1.0.19 the name reply is the device serial, so the result keeps
only its length and whether it matches the selected device, and the run fails
if serial text or bytes reach the evidence. Replies establish what the
firmware reports, not what the panel or LEDs physically show. In the
reconstructed firmware, the first keep-alive after idle restarts the lighting
effect, and the LEDs were seen flashing during these runs.
