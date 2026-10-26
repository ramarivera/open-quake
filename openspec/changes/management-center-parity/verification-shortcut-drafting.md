# Saved-model shortcut drafting

Verified on 2026-10-26. Task 8.1 and `open-quake-lih.17.1.40` remain open for
reviewed delivery and merge.

The production root now supplies the shortcut draft callback from the existing
direct-inference host. It resolves the saved default-role model in the default
scope and native credentials through ChatInference and the Vercel facade.
Generation creates no chat session and enables no tools. ShortcutService still
decodes the generated JSON and rejects unsupported actions before any explicit
library save or profile sync.

The operation refuses overlap, has a 60-second full-operation deadline and a
32 KiB UTF-8 text limit, and limits output tokens to the smaller of 4096 and the
saved budget. Interruption and application shutdown abort and join generation.
Shutdown interruption returns the existing unavailable IPC reply. The named
draft span is registered in the diagnostic allowlist.

## Consumer verification

The new native smoke imports the actual application root with normal preload,
React UI, agent storage, native encrypted credential owner and production
inference facade. Its provider is an isolated synthetic HTTP server. Windows
stay invisible, nonfocusable and click-through; the mock hardware uses the real
codec/conductor over fake HID. Explicit E2E runs disable timed demo knob events
so unrelated demo profile selection cannot invalidate the persistence check.
Regular mock preview retains demo events.

The final run verified the missing-model refusal without HTTP, saving and using
the selected model and native secret, the real Generate form, an editable hotkey
with a shell action dropped, unchanged library/chat history and byte-identical
profile storage, malformed output preserving the table, and provider connection
closure during actual application quit. Retained diagnostics include
DesktopChat.draftShortcuts and omit the synthetic key, prompt and generated
content. Four captures at 1180 and 390 wide were inspected, including the results
table. Its existing narrow horizontal table scrolling is preserved.

Evidence is external under
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-finish/shortcut-drafting/`.
The final native run is `shortcut-draft-MbdoLi`, with `result.json` and captures;
`native-final-2.log` records the success marker and no interrupted-fiber error.

## Checks

- Full desktop suite: 1629 passed and one existing native skip.
- Full edge suite: 647 passed and three existing live skips.
- Focused host, root, integration and diagnostic checks: 113 passed.
- Desktop and edge typechecks, production build, both bundle modes, scoped
  Biome and strict OpenSpec validation passed.
- TestClock proves the generation remains pending at 59999 ms, fails at 60000 ms
  and cancels its provider. Host tests cover missing/failed credentials,
  fragmented output, invalid/empty/oversized UTF-8 output, overlap, caller abort
  and awaited idempotent disposal.
- Running the new host test against the prior source fails four cases because
  the production draft method is absent. Six rejection cases also pass on that
  source and are not presented as regression proof.

No live provider inference, hardware, microphone, audible output or focus-taking
interaction was used for this change. Hosted package/download checks and
current-head bot review are required before merge.
