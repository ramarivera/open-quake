# Proposal

## Why

The recovered DFU short command and RP2040 UF2 metadata establish an update starting point. Firmware writing requires its own target validation and completion evidence beyond a successful file copy.

## What Changes

- Define confirmed DFU entry on the selected QUAKE device.
- Specify local UF2 validation, boot-volume selection and recoverable write states.
- Separate write completion from verified reconnection and firmware identity.

The settings-firmware lane now supplies the scoped implementation and automated evidence. Physical acceptance remains open; see tasks.md and the desktop maintenance README.

## Capabilities

### New Capabilities

- `firmware-dfu`: Define confirmed DFU entry on the selected QUAKE device.

### Modified Capabilities

None. Existing in-flight SDK, profile, display, AI and theme contracts remain owned by their changes.

## Impact

`packages/protocol` pure DFU encoding and UF2 validation; `packages/device` selected-device DFU lifecycle; `packages/edge` firmware workflow and catalog errors; `packages/client` typed update API; `apps/desktop` file/volume/bookmark adapters and update UI. `packages/cli` can reuse explicit inspect/DFU actions without owning flash logic.

Recommended phase: Raw DFU entry supports first-release protocol cut item 1 after hardware validation. Full flashing UX is Later phases item 8 and must not block the local first release.

Research: `/Users/ramarivera/dev/open-quake/.context/research/dk-suite-feature-inventory.md`, sections 7–9 and Later phases. Evidence and unresolved decisions are recorded in design.md. Exact runtime dependencies and their rationale are documented in apps/desktop/src/main/maintenance/README.md.

Implementation now includes SETTINGS-020, SETTINGS-034..048 manual version/dialog/volume/update behavior; physical acceptance remains separate.
