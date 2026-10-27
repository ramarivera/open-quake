# Local Effect diagnostics

Create one `createDesktopDiagnostics({ directory })` in Electron main after
`app.getPath("userData")` becomes available. Use a dedicated `diagnostics`
subdirectory. This module bridges Effect 3.22.1 logs and native tracer completions through
Pino 10.4.0. Pino serializes only the existing privacy projection, once, into
stdout and the bounded private file writer. It requires no remote credentials.
Domain services keep using `Effect.log` and named spans.

Use `makeDesktopRuntime(applicationLayer, diagnostics)` for runtime roots. It
provides diagnostics during acquisition, then wraps the final application tracer
with a fresh layer pass so application-supplied tracers and loggers survive. It
records each span once. For bare `Effect.runPromise` boundaries, provide the shared
`diagnostics.layer` directly.

Wrap boundary effects with `diagnostics.instrument(effect, "voice.request")`
before `catch`, `match`, or `exit`, so failed span exits survive recovery.
Each request receives an opaque main-process-generated ID. Effect fibers inherit
the parent span and request ID. Calls to `instrument` from asynchronous work
inside a traced Effect capture that context across separate ManagedRuntime calls.
For callbacks registered now and invoked later, register
`diagnostics.bind(callback)` inside the current Effect. Binding retains only
trace/span identifiers and the generated request ID alongside the callback. It
doesn't retain the span's attributes, events, exit or callback payload.
Never accept renderer-supplied trace IDs, operation names, or span names.

Dispose background subscriptions and all runtimes before calling
`await diagnostics.close()`. Close drains accepted records, fsyncs the current
file, and closes the handle. It's idempotent. Check the returned status for
`storageFailures` and `dropped`; both mean the trace may be incomplete. `flush()`
provides an inspection barrier during a running session. Close stops stdout
admission, waits for accepted stdout write callbacks, then retains a final health
record in the file and closes the file writer. The health record is local-only,
so its stdout failure/timeout fields describe the completed stdout drain attempt.
File sync/close errors remain visible in the returned status even if they occur
after that record. `closed` means admission ended, not that delivery succeeded.
Storage and stdout failures never replace the application's failure.

Stdout uses the same projected Pino lines as the file, excluding the final local
health record. It defaults to a 512 KiB pending-byte cap, with a hard 2 MiB cap,
and drops new stdout copies when full or failed. The file queue remains independent.
`stdout: false` disables the copy for isolated consumers. `stdoutDrainMs` defaults
to 1000 ms and is bounded to 1 through 5000 ms. A timed-out callback remains counted
in `stdoutPendingBytes`; `stdoutTimedOut` never claims successful delivery. The
shared stdout stream stays open. A late-error guard remains attached after failure
or timeout so delayed stream errors cannot crash the application.

Check `pinoFailures`, `stdoutFailures`, `stdoutDropped`, `stdoutPendingBytes` and
`stdoutTimedOut` as well as file status. `lastOutputFailure` contains only the
existing safe error projection. Pino has no worker or hidden transport queue here.
A synchronous Pino serialization/destination failure attempts a safe local JSON
fallback and increments `pinoFailures`. Stdout callback completion proves acceptance
by the local stream, not delivery to a terminal, file collector or remote service.

## Find and export a physical test's records

The root supplies `<Electron userData>/diagnostics`. Electron's macOS default is
under `~/Library/Application Support/<app name>/diagnostics`; use the actual
`app.getPath("userData")` value because the application can override it.
The files are private to the user, with directory mode `0700` and file mode
`0600`.

`diagnostics.0.ndjson` is newest. Read larger numbered files first for
chronological rotation order. Each line is JSON. Schema 1 and existing field names stay compatible. The additive
`pino_level` field is numeric Pino severity; logs retain their Effect string `level`,
and `time` stays ISO 8601. No `pid`, hostname, raw `msg` or raw `err` is added. Filter by `session_id` for an
application launch, `request_id` for an IPC or physical-input operation, and
`trace_id` for its nested work. A span's `parent_span_id` references the parent;
logs carry the active `span_id`. `sequence` reveals dropped or rotated records
within a session. `duration_ms`, `outcome`, catalog `code` and `_tag`, cause
`kind` and safe source identities are the
fields to use when investigating a failure.

After a user test, flush first or stop the application normally. Copy the
`diagnostics` directory to the task's scratch directory to export it. Export is
a local filesystem operation; this module has no network destination. Review
storage status as well as exported lines before treating missing records as
proof that an operation didn't run.

## Retention and privacy

Defaults retain thirty files of at most 10 MiB each and at most 512 KiB queued
in memory. The first write after local midnight also rotates the active file.
Old files rotate out. Retention settings have hard upper bounds of thirty files,
16 MiB per file, and 2 MiB queued memory. A full queue drops new
records and increments `dropped`. It never blocks microphone or input work.
Existing files over the configured size limit are discarded on acquisition.

The writer receives only a projected record. It never serializes arbitrary
messages, annotations, span attributes, events, links, request bodies, prompts,
transcripts, PCM, headers, credentials, provider URLs, exception messages or
full stacks. The root replaces Effect's console logger and removes the raw tracer logger,
while preserving explicitly supplied application loggers.
The active native span receives only the same projected log event, with raw log
annotations omitted. Native span IDs and parent relationships remain unchanged;
this is local Effect tracing, not OTLP export or vendor ingestion. Re-providing
the shared layer retains the installed tracer rather than returning `Layer.empty`.
Explicit external parent spans take precedence over context captured when an
Effect was constructed. Static application event and span names come from `known-names.ts`.
Unknown names become `effect.log` or `redacted.span`. Allowlisted native filesystem/network codes and numeric HTTP status also
survive projection. Foreign stack frames are omitted. Named operation spans identify the failing local operation without trusting provider-supplied source locations.
Catalog codes and tags are allowlisted. Error projections traverse private
`originalCause` and native `cause`, with depth and node limits, and preserve
Effect failures, defects, parallel/sequential causes and interruption. Raw causes
remain on the original application error, never in the diagnostic file.

When adding instrumentation, update the static allowlist for new source names
and ensure new catalog identities are recognized in `privacy.ts`. Don't allow
arbitrary strings merely because they resemble a code or filename.

Run the focused integration suite with
`pnpm --filter @open-quake/desktop test src/main/diagnostics`.
`pino.test.ts` compares real Pino stdout/file lines against captured native Effect
spans and their parent chains through an application-supplied tracer at the
production runtime root, including concurrent requests, reusable Effects,
deferred callbacks, repeated layer provision, finalizers and broken destinations.
It uses fake transport and voice ports, real Effect consumers, and private
scratch directories. It never opens a window, microphone, hardware device or
live provider connection.

Foreign Error.stack values are never retained, even when they contain known source basenames. Named Effect spans identify the local operation; catalog and OS error codes preserve the failure chain without trusting provider-supplied stack positions.
