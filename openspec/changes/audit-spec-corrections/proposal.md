# Proposal

## Why

The 0.4.95 audit found eight incorrect claims in the existing parity plans. Correcting them before implementation prevents incompatible firmware validation, stale speech routes and behavior based on missing-source assumptions.

## What changes

- Correct standard UF2 magic, `QUAKE DFU` identity and app offset (`SETTINGS-039/047/048`).
- Update speech defaults against current official documentation and require OpenAI TTS (`AI-094/101/105/108`).
- Correct shipped translation, export formats and local chat titles (`AI-136/236/292/315/327/338`).
- Record known knob LED bytes while retaining hardware-controls ownership (`SETTINGS-021`).
- Decode recovered soundboard actions/fades and copy looping playlists (`KNOB-082/083/086`).
- Record the six-channel catalog (`CENTER-072/073`) and rename the unrelated monitoring override (`MAIN-096`).

## Capabilities

### New capabilities

None. This is a documentation correction effort.

### Modified capabilities

The existing in-flight deltas for `firmware-dfu`, `voice-stt-tts`, `meeting-minutes`, `ai-chat-core`, `device-lighting-config`, `soundboard-player`, `integration-channels` and `system-monitor-tiles` are corrected in place. There are no published main specs yet. Their corrected deltas remain the owning contracts; this bookkeeping change uses `skip_specs: true` rather than duplicating them in a second change. `settings-and-wizard` cross-references are reconciled too.

## Impact

Specs and supporting documentation only. No implementation, dependencies, migrations, live provider calls, hardware access or firmware writes. `inventory-errata.md` retains the corrected local-only inventory row. `external-research-edit.md` gives the exact unperformed edit for the separate research repository.

Execution epic: `open-quake-lih.20.1`, child of cluster `open-quake-lih.20`. Tasks and closure evidence are in `tasks.md`. Implementation tasks in the affected feature changes remain open.
