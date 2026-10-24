# Proposal

## Why

The desktop needs a usable local first-run path and one validated settings model. The recovered app mixes QUAKE, ARIS-68 and account/runtime setup, so parity boundaries must be explicit.

## What Changes

- Define local first-run completion, locale/region seeding, display/profile setup and guide access.
- Specify general, AI and capability-gated device settings with persistent validation.
- Document QUAKE-only recommendation, calibration evidence limits and the section 10 exclusion in design only.

Section 5 now implements backup/restore, reset, permissions and app-update scheduling. The broader wizard and general settings tasks remain open.

## Capabilities

### New Capabilities

- `settings-and-wizard`: Define local first-run completion, locale/region seeding, display/profile setup and guide access.

### Modified Capabilities

None. Existing in-flight SDK, profile, display, AI and theme contracts remain owned by their changes.

## Impact

`packages/edge` settings/wizard contracts, invariants, repositories and conductors; `packages/client` typed settings API; `apps/desktop` OS preference/secret adapters, wizard/settings/guide UI and composition root. `packages/device` owns capability-backed brightness/lighting writes; `packages/protocol` owns verified encodings. AI, wallpaper, profiles, firmware and runtime lanes retain their respective implementation ownership.

Recommended phase: Minimum local wizard, locale, AI and device controls support the first-release cut. Expanded settings and guide follow those capabilities; optional runtime steps wait for Later phases item 5. Full firmware UI remains Later phases item 8 in firmware-dfu.

Research: `/Users/ramarivera/dev/open-quake/.context/research/dk-suite-feature-inventory.md`, sections 7–9 and Later phases. Evidence and unresolved decisions are recorded in design.md. Exact runtime dependencies and their rationale are documented in apps/desktop/src/main/maintenance/README.md.

The settings-firmware lane implements SETTINGS-014 backup/import, SETTINGS-015 permissions, SETTINGS-016 reset, and SETTINGS-049/050 self-update. Other wizard/general settings tasks remain owned by their existing work.
