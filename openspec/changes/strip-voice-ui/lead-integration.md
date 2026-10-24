# Voice and monitor integration

Verified on 2026-10-24 in `/Volumes/ExtSSD/devplane/oq-strip-voice`, merging
main `bdf8ca82dbaa661d30dab5514178369420cdb0e5` into voice head
`8c042d2defa27ec03650d056dcbf2369123e791b`.

The registry retains voice, chat and monitor tiles. The media fixture
registers and disposes both runtimes. The monitor fixture registers mock
voice because the combined strip renderer mounts voice hooks.

## Verification

- `pnpm biome check packages apps` passed, 460 files.
- `pnpm typecheck` passed.
- `pnpm exec turbo run test --force` passed, 1014 tests across four packages,
  zero cached test tasks.
- `pnpm build` passed.
- `pnpm --filter @open-quake/desktop test:bundle` passed for default HID and
  explicit mock, without hardware I/O.
- `openspec validate --all --strict` passed, 36 items.
- Voice, knob, media and monitor native mock smokes passed. The voice smoke
  exercises rejected drafts, typed-only assistant selection, mounted draft
  reset, busy expiry and active grid capture through the real preload/IPC.
- Lead inspected fresh rejected-draft, rich conversation and tactical monitor
  captures. GitHub reports seven review threads, all resolved.
- No task-owned app process remained after the verification run.

Logs and voice/knob/media captures:
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/strip-voice/lead-integration/`.
The commands and detailed assertions for native fixtures are in
[review-round-1.md](review-round-1.md) and the monitor verification document.
Monitor captures:
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/monitor-panel/voice-integration/`.

## Remaining acceptance

This run used mock device events and mock voice levels. Real microphone
capture, provider integration, buzzer output, physical knob holds, touch and
strip display acceptance remain open under the parity hardware tasks.
The native monitor probe reported CPU unavailable during this run; GPU and
temperature support remain limited as documented by the monitor change.
