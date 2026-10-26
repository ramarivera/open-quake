# Emoji generation and native smoke

Motion generation uses a saved Qwen credential directly with DashScope's
`wan2.2-i2v-flash`. It creates and polls an asynchronous five-second, 480P job,
downloads video without forwarding the credential, then converts it to GIF in
a hidden, muted decoder. Explicit cancellation and the 300-second deadline stop
local work. Caption suggestions use the saved daily/default model and require
explicit acceptance before changing the editor.

The native smoke mounts the production emoji page, shortcuts page and emoji
tile over fake bridges. It exercises locale changes, byte limits, caption
acceptance, draft/package editing, selection, rollback, rename, app artwork,
pinned artwork and legacy inline thumbnails. It makes no provider calls.
Run these commands sequentially from the repository root, with an existing
absolute SSD directory in `OQ_EMOJI_SCRATCH`:

```sh
TMPDIR="$OQ_EMOJI_SCRATCH" pnpm --filter @open-quake/desktop exec electron-vite build --config src/main/emoji/smoke.config.ts
env -u ELECTRON_RUN_AS_NODE OPEN_QUAKE_MOCK_DEVICE=1 TMPDIR="$OQ_EMOJI_SCRATCH" pnpm --filter @open-quake/desktop exec electron out/emoji-smoke/main/smoke.js "$OQ_EMOJI_SCRATCH/screenshots" "$OQ_SILENT_VIDEO"
```

`OQ_SILENT_VIDEO` must point to a local silent MP4 with changing frames, at
least half a second long and at most ten seconds. The smoke also passes those
bytes through the production decoder and checks that the resulting GIF has
changing frames. All windows stay hidden and muted. Screenshots and temporary
user data belong in scratch storage, outside the repository.

Physical clipboard/paste/send behavior and live paid-provider compatibility
remain separate acceptance checks.
