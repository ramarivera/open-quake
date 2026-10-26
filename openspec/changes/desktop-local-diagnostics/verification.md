# Production diagnostics acceptance

Source was audited on merged main `6474d65` on 2026-10-26. The audit found one
remaining bare reporting boundary in firmware-session recovery. Maintenance now
passes the process-owned destination to that store. A named `FirmwareSession.load`
failure retains `QUAKE.FIRMWARE.PERSIST_FAILED` and its private cause before the
existing safe warning and recovery. Unreadable evidence is still preserved before
later saves. No schema, dependency, permission or firmware-write behavior changes.

## Ownership audit

| Production boundary | Shared destination and lifecycle |
| --- | --- |
| Main background, weather/media, media, clock, device lifecycle and key runtime | `main/index.ts` supplies `makeDesktopRuntime` with the single process-owned diagnostics instance. |
| Profiles, knob, agents, integrations, emoji, meetings and monitor | Root supplies diagnostics to each registration; its runtime uses `makeDesktopRuntime`. |
| Direct chat, HTTP conversations, voice and general settings | Registrations provide the shared diagnostics layer before acquisition and wrap their interpreter boundaries. |
| HTTP connection acquisition and requests | Bare interpreters provide the shared layer and instrument before safe IPC projection. |
| Hardware requests and lock/unlock | Bare interpreters instrument the device work before recovery and logging. |
| Maintenance acquisition, recovery and shutdown | Main supplies diagnostics; maintenance runtime, initialization reporting and firmware-session recovery retain the same destination. Main drains services and finalizers before closing diagnostics. |

The remaining direct synchronous calls in chat selection, agent credential
serialization and maintenance coordination only construct semaphores. They do no
IO or reporting. Preload RPC-client runtimes are renderer transport clients;
privileged domain execution and durable records stay in main. Backup proof files,
test fixtures and smoke launchers are not production composition.

## Fresh automated verification

The production maintenance registration test fails on the previous implementation
because it writes no firmware recovery span. It now verifies the actual store,
shared destination, catalog identity, safe cause, generated request/trace IDs,
warning and zero-loss shutdown. Error names follow the existing safe projector,
which normalizes the native syntax exception to `Error`.

All 159 focused diagnostics, speech, chat, HTTP, knob-diagnostic and firmware
initialization/recovery tests pass with external TMPDIR. Desktop typecheck,
scoped Biome, strict OpenSpec validation and the actual app build pass. Existing
coverage includes failed acquisition/finalizers, all interpreter methods,
connection and GridVoice failure before recovery, synthesis-only failure,
concurrent request isolation, cancellation, hostile values, bounded queues,
rotation and failed storage. The initial focused run used the default symlinked
TEMP location and hit the existing HTTP-storage path guard; external TMPDIR
passes without weakening the guard.

A fresh hidden Electron run uses the production main, preload and renderer with
mock hardware and a synthetic loopback model. It exercises direct chat, provider
auth rejection, physical HTTP abort, safe Markdown, history, locale broadcast and
an intentionally corrupt firmware-session fixture. Normal app shutdown retained
1,104 contiguous records with a correlated firmware failure, no private fixture
text, no provider credential, no transcript sentinel and no full local paths.
Directory/file modes are 0700/0600; final health reports zero drops and zero
storage failures. All windows stayed hidden and no mic, provider account or HID
was opened. Two earlier external build placements failed the smoke's scratch-path
guard before app startup; owned Electron processes were stopped and the build
layout was corrected. No guard was removed.

Reproducible external launcher, build config, checks and captures are under
`open-quake-finish/diagnostics-final/`, with the accepted run `direct-chat-H5z3c8`
and `audit.json`. Run artifacts are not committed.

## Retained integration evidence

The saved native-media, brightness and hotkey fault runs were re-read rather
than inferred from prior summaries. They retain the original EACCES identity
under their catalog failures with generated request and trace IDs. Their normal
shutdown health records report zero loss. The real-device thumbnail run and real
desktop-to-runtime run also retain complete zero-loss shutdown evidence.

| External acceptance directory | Retained records |
| --- | --- |
| `system-media/root-YsaxQ7/data` | 629 |
| `monitor-brightness/native-U4ZOe4/data` | 368 |
| `knob-hotkeys/native-pRinSF/data` | 372 |
| `device-acceptance/run-2p3HKr` | 1,778 |
| `redesign/runtime-final/desktop-e2e-QlVZ5A` | 1,746 |

These paths are relative to the project's external `open-quake-finish` scratch
folder. They prove retained software evidence, not physical keys, microphone
permission, hearing or strip readability. Those acceptance obligations remain
open in their owning changes. Reviewed delivery of this last reporting fix is
still required before closing the two diagnostic integration beads.
