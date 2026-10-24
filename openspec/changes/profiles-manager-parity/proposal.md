## Why
Cluster 8 has no shipped profile catalog, profile manager or automatic foreground-app selection. PR #12 supplies the versioned profile repository to extend. This change covers AUDIT_MGMT MGMT-091, 313–324, 326–327, 329–340, 343, 345–384 and AUDIT_MAIN MAIN-079, 084–085.

## What Changes
- Recover nine built-in layouts and eight-language labels, with per-OS Quick variants and explicit safety adaptations from decisions 12, 13 and 15.
- Add atomic manager operations, visibility, weighted names, startup default, linked apps and thumbnail generation with typed IPC.
- Add foreground polling and per-device selection delivery, including first-connect override and duplicate-report protection.

## Capabilities
### New Capabilities
- `profiles-manager`: catalog, profile management and foreground switching.
### Modified Capabilities
None. The profile envelope gains backward-compatible optional manager metadata. Strip geometry remains owned by the strip-grid lane.

## Impact
packages/device profile domain; desktop main, preload and functional management UI. No dependencies. Physical profile delivery and native permissions require lead-owned hardware verification.
