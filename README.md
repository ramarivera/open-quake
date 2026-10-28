# open-quake

An open-source desktop controller for the DecoKee QUAKE.

[Downloads](https://github.com/ramarivera/open-quake/releases) · [Installation and releases](docs/releases.md)

Desktop installers target Apple Silicon macOS, Windows x64/ARM64 and Linux x64/ARM64. PR/local builds are unsigned for distribution; macOS tag releases require Apple signing and notarization. Platform/hardware support is still under development. A release is available only after its version-tag workflow publishes it. The private workspace packages aren't published to npm.

For development, install Node 24 and pnpm 10, run `pnpm install --frozen-lockfile`, then `pnpm --filter @open-quake/desktop dev`. Only one app instance may own the QUAKE at a time. Use `OPEN_QUAKE_MOCK_DEVICE=1` for development without opening hardware.

## Exercise the management window

Run `pnpm --filter @open-quake/desktop exercise:management` after installing the
locked dependencies. It builds the production renderer and preload, then builds
the real `src/main/index.ts` composition root behind an opt-in Electron fixture.
No additional dependencies or test server are needed.

Each run writes the build, `report.json`, page screenshots, a panel screenshot and isolated
`userData` under
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-ui-exerciser/run-*`.
The printed report path identifies the run. Exit status is nonzero for a failed
control, scenario or renderer/main error. A failing run is expected while the
tracked icon-library, move/swap and Luminance-title bugs remain on the branch.

The fixture disconnects and reconnects its fake bus to keep Connection visible.
A build token defined only by the fixture config exposes that synthetic bus;
the normal production build has no enabled hook.

The fixture visits every sidebar page and discovers controls again after each
action, including controls revealed by tabs and details. It uses Chromium input
through `webContents.sendInputEvent` and `insertText`, observes DOM mutations,
editable focus, navigation, dialogs and IPC calls, and checks persisted key order,
titles, editable wide-tile placement and covered-cell swaps, and the active profile delivered to the production panel. The report
includes every discovered control's result and the explicit skip/expected-inert
policies from `src/main/management/exerciser-policy.ts`.

This fixture stays hidden and disables native window activation. Native dialogs
and external navigation are recorded at their Electron boundary and cancelled
so they can't steal focus. Destructive actions, OS actions, credentials, native
pickers, audio and paid generation are skipped with reasons. This is a bounded
smoke sweep of reachable states, not every combination of settings.

The fake-device selection is compiled only into `exerciser.config.ts`, with
a non-scripted `startMockHardwareBus` and a rejecting replacement for `node-hid`.
The fixture rejects packaged execution before importing the root. It's never
imported by the production entry or included by the packaging build; setting an
environment variable in an installed app cannot enable this fixture. It never
opens hardware, starts DK-Suite or accesses the owner's profile. Keep report
files and screenshots in scratch storage, never in git.
