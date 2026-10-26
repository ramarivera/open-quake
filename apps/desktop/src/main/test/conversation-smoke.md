# Conversation coverage

Vitest uses the desktop's existing Node environment and server-rendered React tests. It needs no browser installation. The release workflow and browser dependencies are unchanged.

Mounted interaction, layout, scrolling and computed-style assertions run separately in the hidden native smoke. Its prerequisite is the repository-pinned Electron binary installed by the normal `pnpm install`, with a host that can launch Electron. It never requires a separate Chromium or Playwright installation.

From the repository root, use an absolute SSD scratch directory for `TMPDIR` and `OPEN_QUAKE_CONVERSATION_SCRATCH`. The latter receives English and German 1920 by 480 screenshots. In Nushell:

```nu
let scratch = "/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/burndown/test-conversation"
mkdir $"($scratch)/tmp" $"($scratch)/screenshots"
pnpm --filter @open-quake/desktop exec electron-vite build --config src/main/test/conversation-smoke.config.ts
with-env { TMPDIR: $"($scratch)/tmp", OPEN_QUAKE_MOCK_DEVICE: "1", OPEN_QUAKE_CONVERSATION_SCRATCH: $"($scratch)/screenshots" } {
  ^env -u ELECTRON_RUN_AS_NODE pnpm --filter @open-quake/desktop exec electron out/conversation-smoke/conversation-smoke.js
}
```

The dedicated test document mounts production components with synthetic preload bridges. Real DOM touch registration and the production knob model feed the strip consumers. Its Node-enabled window belongs only to this test entry; production renderer security options are unchanged. All windows stay hidden and muted, and the temporary Electron profile is removed on completion. No HID device, microphone or remote provider is opened.

Root tests must preserve the SSD temporary directory through Turbo:

```nu
with-env { TMPDIR: $"($scratch)/tmp", OPEN_QUAKE_MOCK_DEVICE: "1" } {
  pnpm exec turbo run test --env-mode=loose -- --maxWorkers=2
}
```
