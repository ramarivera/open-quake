# Design

## Correction ownership

The requirement text stays in its existing feature change. This correction change records provenance and delivery evidence, and introduces no separate runtime contract. It is docs-only, so `skip_specs: true` applies to this bookkeeping change while strict validation still checks every corrected feature delta.

## Evidence

Audit root is the local-only `/Users/ramarivera/dev/dark-encyclopedia/dk-suite-introspeccion/v0.4.95/audit/`. Renderer/main recovered source root is its sibling `recovered_sources/src/`; the bundled main process is `app-resources/background.js`. Read sources as text only.

| Correction | Audit rows | Owning artifact |
| --- | --- | --- |
| Standard UF2 magic, vendor volume, app offset | SETTINGS-039, SETTINGS-047, SETTINGS-048 | firmware-dfu spec and design |
| Current speech routes/models and OpenAI synthesis | AI-094, AI-101, AI-105, AI-108 | voice-stt-tts spec and design |
| Shipped translation, bounded display and text export | AI-136, AI-292, AI-315, AI-327, AI-338 | meeting-minutes and voice-stt-tts |
| First message title, at most 10 characters plus ellipsis when longer | AI-236 | ai-chat-core and inventory-errata.md |
| Known knob LED command | SETTINGS-021 | device-lighting-config, minimal evidence correction |
| Recovered audio mappings and indefinite playlist wrap | KNOB-082, KNOB-083, KNOB-086 | soundboard-player |
| Six known channel descriptors | CENTER-072, CENTER-073 | integration-channels |
| Monitoring override naming | MAIN-096 | system-monitor-tiles and settings cross-reference |

Official Microsoft UF2 and Alibaba Model Studio URLs and access date 2026-10-24 are recorded next to the owning requirements/design. Alibaba's current documented STT default is `qwen-audio-3.1-asr-flash-streaming`; 0.4.95 uses `qwen-audio-3.0-asr-flash-streaming`. Preserve that distinction. Current documentation recommends workspace-specific hosts for both STT and TTS. No paid request was made.

The OpenAI TTS requirement follows `AI-105`; current official OpenAI documentation also gives a 2027-01-06 shutdown for the audited `gpt-4o-mini-tts` Speech API model. Record that compatibility limit and keep a successor Realtime workflow distinct. An adapter requirement is not evidence that audio playback or credentials work.

## Decisions

- Copy playlist wrap and continuous playback. The gap map treats it as intended parity, with no bug exception. Keep bounded unavailable-file traversal and existing privacy/audio-ownership safeguards.
- Keep manual chat titles on later sends. DK-Suite overwrites them, but that defect is already a deliberate open-quake replacement.
- Retain bounded translation history instead of the unbounded growth noted in `AI-338`.
- Keep the full knob LED transport/lifecycle requirement with hardware-controls. This lane only replaces the unknown-command claim with recovered bytes.
- Preserve the existing monitoring overlay behavior under the name "monitoring override"; hardware-controls owns device-typed hotkeys.

## Local-only research

The feature inventory is gitignored. A corrected copy lives in this worktree at `.context/research/dk-suite-feature-inventory.md`; its exact replacement entry is versioned in `inventory-errata.md`, which supersedes the old first-exchange claim for this PR. The original main-checkout research file is untouched because this lane works only in its assigned worktree.

`REVERSE_ENGINEERING.md` is absent from the open-quake repo and its vendored skill, and exists only at `/Users/ramarivera/dev/dark-encyclopedia/REVERSE_ENGINEERING.md`. It is not edited. `external-research-edit.md` contains the exact §9.12 replacements for the lead.

## Verification boundary

Run `openspec validate --all --strict`, `pnpm biome check packages apps` and `git diff --check`. Inspect the complete diff to confirm docs/spec-only scope and audit citations. No runtime behavior, provider request, physical audio, pairing, device command or flashing is verified. Do not check off existing implementation/hardware tasks on source evidence.
