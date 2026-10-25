# open-quake

An open-source desktop controller for the DecoKee QUAKE.

[Downloads](https://github.com/ramarivera/open-quake/releases) · [Installation and releases](docs/releases.md)

Desktop installers target Apple Silicon macOS, Windows x64/ARM64 and Linux x64/ARM64. Builds are unsigned and platform/hardware support is still under development. A release is available only after its version-tag workflow publishes it. The private workspace packages aren't published to npm.

For development, install Node 24 and pnpm 10, run `pnpm install --frozen-lockfile`, then `pnpm --filter @open-quake/desktop dev`. Only one app instance may own the QUAKE at a time. Use `OPEN_QUAKE_MOCK_DEVICE=1` for development without opening hardware.
