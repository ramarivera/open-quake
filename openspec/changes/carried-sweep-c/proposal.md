## Why
Five carried bugs misrepresent unavailable weather and local runtimes, mislabel CPU hardware as a GPU, complete a gesture during vendor takeover, and intermittently fail the Windows arm64 installer smoke.

## What Changes
- Render localized weather configuration and failure states, and recover after configuration.
- Require an existing executable file for a configured local agent command.
- Label the anime monitor hardware field accurately when only the CPU model is available.
- Cancel an active DOM touch before vendor input takes ownership.
- Wait for prior Windows package processes and retry installation within fixed bounds with diagnostics.

## Capabilities
### New Capabilities
- `carried-bug-recovery`: truthful fallback states and bounded input/installer recovery.
### Modified Capabilities

## Impact
Epic `open-quake-nnh`; execution beads are listed in tasks.md. Desktop renderer, local agent adapter and package smoke installation helper. No dependencies, device operations or workflow structure changes.
