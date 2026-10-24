# Proposal

## Why

The merged grid and profile catalog need an editor that previews safely, an icon picker, and the recovered key runtime. Cluster 9 records observable gaps in editing, translated labels, icon packs and repeated key presses.

## What Changes

- Preview key drafts in management and on the strip, revert on selection changes, and persist only on Save. Clock settings keep their existing auto-save path.
- Preserve user titles separately from eight-language defaults and enforce the 20-weight input limit.
- Add the approved exact @mdi/svg 7.4.47 asset dependency, searchable and zoomable icons, Stream Deck/iconfont pack import and reference protection.
- Enable two-shortcut alternation, timer/countdown/alarm, cancellable multi-action progress and wrapping page/slide navigation.
- Correct the focused-field Delete hazard in MGMT-249.

## Capabilities

### New Capabilities

- `key-library-parity`: Cluster 9 editing, icon library and runtime acceptance contract, supplementing the unarchived profiles-key-grid, key-function-library and artwork-library changes.

### Modified Capabilities

None. This repository has no archived main specs.

## Impact

Device action/profile contracts and desktop main/preload/renderer. Reuse the built-in catalog and touch recognizer; retain grid geometry and knob ownership. No proprietary icon packs or real-device verification. Any dependency beyond approved @mdi/svg requires a separate decision.
