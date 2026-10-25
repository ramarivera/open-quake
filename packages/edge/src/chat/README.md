# Chat protocol and direct session service

Browser callers import `@open-quake/edge/chat/contracts` for Schema contracts
and `@open-quake/edge/chat/reducers` for pure state transitions. Neither entry
imports the provider service, credentials, SDKs, or host code.

Each accepted turn pins a `TurnSelection`, including session/turn IDs, profile,
model, mode, and auth generation. Chunks have version 1 and contiguous sequence
numbers starting at zero. `answer` appends text verbatim. `followUp` contains a
complete suggestion and never changes answer text. `end` carries a terminal
outcome, optional stable error code, and optional reported/estimated usage.

At transport boundaries, use `decodeAndReduce(state, input)`. It decodes unknown
input with `ChatChunk`, rejects excess fields, and returns an `Either` containing
the new state or a Schema `ParseError`. Malformed input never reaches reduction.
`reduceChunk` requires an already decoded `ChatChunk`.

`emptyTurn` starts at `lastSeq: -1`. `reduceChunk` ignores other identities and
duplicates. A gap sets `needsSnapshot` and pauses all further application.
`restoreSnapshot` accepts a matching, non-stale authoritative snapshot, then
reduction resumes strictly after its `lastSeq`. Terminal state never reopens.
Reducers prevent additional terminals. ChatService supplies exactly one terminal
for each accepted turn, independently of subscribers.

`reduceSession` moves accepted input through ONGOING and PROCESSING to IDLE
after completion. Cancellation, failure, and timeout retain IDLE only when a
completed exchange exists. Closing releases context and enters EMPTY. Busy
acceptance and stale callbacks do not mutate state. ChatService translates busy
acceptance into `CHAT.SESSION.BUSY`, cancels upstream on close, and owns deadlines,
bounded queues and history persistence.

## Host composition

Host code imports `ChatService` from `chat-service.ts`, `ChatInferenceLive` and
`ChatSubmit` from `chat-ports.ts`, and `ChatRepository` plus
`fileChatStorageLayer` from `chat-repository.ts`. The browser entry points stay
Schema/reducer-only. The composition root provides the existing shared
`AiRepository`, `AiCompatibleAdapter` and `AiCredentials`.

```ts
const inference = ChatInferenceLive.pipe(
  Layer.provide(Layer.mergeAll(VercelCompatibleAdapterLive, credentialsLayer)),
)
const history = ChatRepository.Default.pipe(
  Layer.provide(fileChatStorageLayer(privateChatDirectory)),
)
const chat = ChatService.DefaultWithoutDependencies.pipe(
  Layer.provide(Layer.mergeAll(sharedAiRepositoryLayer, history, inference)),
)
```

Use the application's private user-data subdirectory for `privateChatDirectory`
and dispose the resulting scoped runtime during shutdown. Keep a single
repository instance per file. `ChatService.Default` provides isolated defaults,
including mock profile metadata. Desktop settings should share their repository
through `DefaultWithoutDependencies` instead. The host supplies authenticated
`owner` identity on every method; renderer input must not choose another owner.

`submit(owner, input)` accepts the existing TurnSelection fields plus `text`.
The caller supplies explicit session/turn UUIDs, profile, model, auth generation
and mode. Optional fields are `systemPrompt`, `modelRole: daily|deepThink`,
`contextWindowTokens` and `outputReserveTokens`. Stale model/auth selections
fail before acceptance. Every accepted turn uses a captured immutable profile
through the real AiProviderService, even when settings change before dispatch.
Voice consumers submit their final nonempty transcript through this same API.
Capture preparation and microphone ownership remain with the voice caller.

The result contains `selection`, the initial `snapshot`, and a one-consumer
`events` stream. Inference belongs to the service scope, so detaching a stream
never cancels the turn. `subscribe(owner, sessionId, turnId)` registers a new
subscriber and captures its snapshot atomically. Restore that snapshot with the
existing reducer, then consume future events. Historical completed turns return
an empty stream plus their authoritative snapshot. There is no event replay.
At 256 buffered chunks the slow subscriber fails with
`CHAT.STREAM.RESYNC_REQUIRED`; other subscribers and inference continue.

Other methods are `snapshot`, `session`, `history`, `list`, `rename`, `cancel`,
`supersede`, `close` and `clear`. `cancel` includes the exact turn ID and waits
for upstream cancellation and terminal finalization. `supersede` cancels the
same owner's active session turn before submitting its replacement. `close`
releases context but preserves history; `clear` cancels and deletes history.
Neither accepts stale callbacks that recreate removed data. Returned history is
host-private and includes the owner; transport code must allowlist public fields.

## Bounds and persistence

Normal is the only enabled direct mode. Other product mode IDs fail with
`CHAT.MODE.UNAVAILABLE` before inference. Normal turns have a 60,000ms absolute
monotonic deadline including acceptance persistence and provider setup. Deltas
don't extend it. An in-flight atomic disk write must settle before terminal delivery, even though
the provider abort signal fires at the deadline. No 300-second tool/media mode
is enabled here. The default
context window is 8192 estimated tokens; a host that knows the selected model
window should pass it explicitly. Output reserve uses the request override,
profile output setting, or a default capped at 1024. Estimates conservatively
count UTF-8 bytes plus message framing. System instructions and new input stay
intact; oldest whole completed exchanges are removed until they fit. If fixed
inputs don't fit, no turn is accepted and no provider call occurs.

The service permits four simultaneous turns, eight subscribers per turn,
32,768 input characters, 65,536 answer characters, and sixteen suggestions of at
most 4096 characters. Supported provider output limits use the reserved tokens;
reported or estimated final output exceeding that reserve fails explicitly. Partial output
stays visible in history but only completed pairs enter subsequent context.
After thirty idle minutes, or explicit close, saved history remains readable
and no earlier context is sent on the next turn. A local title takes the first
ten Unicode characters and appends `...` only when needed. Manual titles persist.

The version-1 JSON store atomically replaces `history-v1.json` using a synced
0600 temporary file in a newly created 0700 directory. Storage has a 64 MiB
limit and does not silently delete history. Mutations settle before another
mutation can overtake them, including when a caller is interrupted. A failed
save retains the previous repository state, reports `CHAT.HISTORY.STORAGE_FAILED`
and never falls back to a volatile successful write. If final persistence
fails, the public terminal reports failure and a bounded in-memory repair record
keeps its snapshot available. The next successful write persists that failure.
Until then, the last durable processing record recovers as interrupted on restart.
New submissions stop once 64 unsaved failure records accumulate. Unsupported schema versions fail without
rewriting the file. No migration from another schema or DK-Suite is claimed.

Tests exercise the installed production SDK through ChatService and the browser
reducer, fake clocks, isolated owners, profile pinning, cancellation, revocation,
slow subscribers, whole-exchange budgets, close/clear, crash recovery and private
file permissions. Desktop/preload/renderer production composition, capture
preparation state, other modes, Codex OAuth inference, and live provider/device
acceptance remain with their owning tasks. The separate Hermes/OpenClaw HTTP
conversation service is unchanged.
