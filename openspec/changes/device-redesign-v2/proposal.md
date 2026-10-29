# Proposal

## Why

Ramiro reports a black device display with lost knob/touch input, residual DK claw branding, unstable profile action labels, disliked Vivid naming/backgrounds and unavailable system metrics. The previous visual change covered only a subset of the device experience; the next design must cover every device view before selection.

## What Changes

- Capture and repair the reproduced runtime freeze and session recovery without changing saved profiles.
- Correct remaining default branding and use one stable profile action label.
- Diagnose metric demand and collection separately from unsupported temperature sources; show an explicit reason for unavailable values.
- Produce two distinct Opus5.5 proposals covering the same 22-device-screen inventory and state variants, including replacement names/backgrounds and visible recovery.
- Present both complete previews for human selection before implementing a new visual direction.

## Capabilities

### New Capabilities

- `device-experience-recovery`: responsive device/runtime recovery, stable default wording, truthful system readings and complete redesign comparison.

### Modified Capabilities

None. Existing capability specs have not been promoted into the repo-local main spec store.

## Impact

Desktop main-process capture/dialog and monitoring paths, profile display aliases, profile-selector copy and relevant automated tests. Proposals are scratch artifacts; no new dependencies, schemas or CI changes are planned. Physical input and provider/audio acceptance remain distinct from software evidence.
