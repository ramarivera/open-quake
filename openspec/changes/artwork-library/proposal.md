# Proposal

## Why

The icon picker and template panel expose local artwork selection and imports. A stable resource contract is needed so editing artwork does not silently claim an unverified emoji-to-device pipeline.

## What Changes

- Define local built-in/imported artwork browsing and stable resource references.
- Support key artwork selection and template imports through one library owner.
- Keep generated emoji packaging and physical 0xA2 transfer behind their owning contracts.

The icons burn-down lane implements picker search, selection, safe picture decoding, resource lifetime, selected previews, thumbnail state presentation and emoji/game artwork. Template imports and unresolved internal helper ownership remain separate obligations. Physical display acceptance remains unverified.

## Capabilities

### New Capabilities

- `artwork-library`: Define local built-in/imported artwork browsing and stable resource references.

### Modified Capabilities

None. Existing in-flight SDK, profile, display, AI and theme contracts remain owned by their changes.

## Impact

`packages/edge` artwork contracts, metadata repository and validation conductor; `packages/client` typed library API; `apps/desktop` file import/preview adapters, icon picker and templates UI. Profile and wallpaper services consume resource IDs; `packages/device` owns delivery and `packages/protocol` pure framing, with no new payload inference here.

Recommended phase: Basic icon selection supports first-release cut items 2–3. Template/emoji library breadth is Later phases item 3; physical delivery depends on the separate resource payload investigation.

Research: `/Users/ramarivera/dev/open-quake/.context/research/dk-suite-feature-inventory.md`, sections 7–9 and Later phases. Evidence and unresolved decisions are recorded in design.md. No npm dependency is added in this spec-only change.
