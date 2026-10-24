# Management Center verification

The application root composes management appearance, agents, integrations and emoji over the existing profile services. The profile repository uses `DefaultWithoutDependencies` with `ManagementProfileContractsLive`; using `Default` would silently retain its empty validator registry and reject DK-Claw saves.

Build the app, then build and run this harness sequentially with Electron:

```sh
# Choose an existing absolute directory with no symlinks in its path.
export OQ_SMOKE_SCRATCH=/absolute/path/to/scratch
pnpm build
TMPDIR="$OQ_SMOKE_SCRATCH" \
  pnpm --filter @open-quake/desktop exec electron-vite build \
  --config src/main/management/smoke.config.ts
env -u ELECTRON_RUN_AS_NODE OPEN_QUAKE_MOCK_DEVICE=1 \
  TMPDIR="$OQ_SMOKE_SCRATCH" \
  pnpm --filter @open-quake/desktop exec electron out/management-smoke/smoke.js \
  "$OQ_SMOKE_SCRATCH/screenshots"
```

Backup path guards reject symlinks, including the macOS `/tmp` alias. Use the real directory path for `OQ_SMOKE_SCRATCH`.

Do not run multiple electron-vite config builds in the same checkout concurrently; they share a temporary config module. Also run the existing `main/media/README.md` smoke after renderer changes.

This harness uses the production preload, renderer and main handlers in hidden native windows. Its userData is temporary and removed on exit. The HA fixture listens only on loopback, asserts the bearer header and rejects token-bearing URLs. It exercises real safeStorage-backed credential writes, agents and skills, protected-main rejection, model routing, DK-Claw profile sync, native static-image import, GIF captions, repeated emoji placement, panel copy-only press, shortcut profile sync, HA key placement/live state and AI allowlist. Panel mutation and native-theme spoofing are rejected. Screenshots include every page and workbench tab in Dark, Grey and Light, the channel catalog, skills, monitor settings, popover, narrow rail, caption dialog and combined emoji/HA panel. All three font scales and keyboard sidebar resizing are exercised.

Runtime boundaries remain explicit: no agent runtime or channel account is installed; AI drafting and emoji motion generation require the owning provider adapters. Manual workspace/skill editing and shortcut libraries remain available. No vendor proxy, generated-code evaluation, global TLS exemption, real device access or DK-Suite launch occurs here.

The native smoke verifies macOS. Windows overlay colors and Linux native appearance are implemented but require their own native acceptance. Physical clipboard format, device-keyboard paste/Enter, external HA and physical QUAKE output remain lead-owned acceptance work.
