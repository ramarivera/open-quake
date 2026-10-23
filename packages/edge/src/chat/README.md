# Chat protocol v1 foundation

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
Reducers prevent additional terminals; the future ChatService must guarantee
that an accepted turn receives its first terminal.

`reduceSession` moves accepted input through ONGOING and PROCESSING to IDLE
after completion. Cancellation, failure, and timeout retain IDLE only when a
completed exchange exists. Closing releases context and enters EMPTY. Busy
acceptance and stale callbacks do not mutate state. ChatService must translate
busy acceptance into `CHAT.SESSION.BUSY`, cancel upstream on close, and enforce
deadlines, bounded queues, and history persistence. Those operations are not
implemented by these reducers.
