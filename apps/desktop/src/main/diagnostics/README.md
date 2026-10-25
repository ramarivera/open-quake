# Local Effect diagnostics

Create one `createDesktopDiagnostics({ directory })` in Electron main after
`app.getPath("userData")` becomes available. Use a dedicated `diagnostics`
subdirectory. This module extends the existing Effect logger and native tracer;
it requires no new dependencies or remote telemetry credentials.

Provide `diagnostics.layer` with `Layer.provideMerge` to every runtime's root
layer. That placement covers acquisition logs and finalizers as well as later
requests. Also provide it to bare `Effect.runPromise` effects at the root.

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
provides an inspection barrier during a running session. Close also persists a health record with drop and storage failure counts when
the destination is writable. Storage errors never
replace the application's failure or throw through the logger.

## Find and export a physical test's records

The root supplies `<Electron userData>/diagnostics`. Electron's macOS default is
under `~/Library/Application Support/<app name>/diagnostics`; use the actual
`app.getPath("userData")` value because the application can override it.
The files are private to the user, with directory mode `0700` and file mode
`0600`.

`diagnostics.0.ndjson` is newest. Read larger numbered files first for
chronological rotation order. Each line is JSON. Filter by `session_id` for an
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

Defaults retain four files of at most 2 MiB each and at most 512 KiB queued in
memory. Old files rotate out. Retention settings have hard upper bounds of
eight files, 16 MiB per file, and 2 MiB queued memory. A full queue drops new
records and increments `dropped`. It never blocks microphone or input work.
Existing files over the configured size limit are discarded on acquisition.

The writer receives only a projected record. It never serializes arbitrary
messages, annotations, span attributes, events, links, request bodies, prompts,
transcripts, PCM, headers, credentials, provider URLs, exception messages or
full stacks. Static application event and span names come from `known-names.ts`.
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
`pnpm --filter @open-quake/desktop test src/main/diagnostics/diagnostics.test.ts`.
It uses fake transport and voice ports, real Effect consumers, and private
scratch directories. It never opens a window, microphone, hardware device or
live provider connection.

Foreign Error.stack values are never retained, even when they contain known source basenames. Named Effect spans identify the local operation; catalog and OS error codes preserve the failure chain without trusting provider-supplied stack positions.
