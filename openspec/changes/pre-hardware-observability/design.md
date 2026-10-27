## Approach

Use pinned Effect 3.22.1 APIs. Reuse the process-owned diagnostics layer, privacy projection, bounded storage and retrieval path. Domain methods use named Effect.fn spans and Effect logging. Logger/tracer lifecycle belongs at runtime roots. Any Pino bridge consumes projected facts, preserves actual trace/span/request correlation, and cannot replace original product errors when storage fails.

Record hardware failures before safe rejection/recovery. Delayed callbacks retain only correlation metadata. Never retain raw input, profile content, transcripts, provider URLs, credentials or arbitrary exception text. Cancellation and shutdown report their actual outcome.

Run two identical Sol/Terra candidates per task on the same source revision, locally only. Independent Opus and Meta Wonder Full judges inspect them before parent integration. Scope is two useful repairs, not a generic tracing framework.

## Hardware candidate decision

Both independent judges, Opus 5.5 and Wonder Full, selected Sol's hardware candidate. Terra's candidate left lighting's separate runtime and production promise-error identity uncovered. The integration guards interruption-only desktop causes, records an owned key failure once before the completion join, and uses an optional parent span for deferred completion. Catalog identity recovery can return the original action code to the renderer instead of the previous generic host-action code.

This was one run per model per task. Hardware elapsed times were about 21 minutes for Sol and 5 minutes for Terra, with different completeness. These runs don't establish general model quality or equal-scope speed, and no cost comparison is available. Physical hardware remains unverified.

## Logger candidate decision

Opus 5.5 and Wonder Full independently chose a combined implementation. Sol's Pino destination bounds accepted stdout bytes and sanitizes native span log events, but its original test supplied the tracer underneath diagnostics rather than through the application layer. Terra's runtime assembly preserves the application tracer; its logger leaves raw tracer events enabled and relies on stream backpressure without an independent pending-byte cap. The integration uses Sol's destination and correlation code with Terra's fresh final runtime pass. It replaces the console logger, removes Effect's raw tracer logger and preserves application loggers.

The assembled consumer now installs its tracer and logger in the application layer passed to `makeDesktopRuntime`. Real native IDs, parent relationships and sanitized events match Pino file/stdout records without duplicated spans. Pending stdout is capped even when a stream accepts writes without callbacks. Close stops stdout admission, reports timeout or loss, retains final local health and closes the existing private rotating file writer. No remote collector is configured.

Logger elapsed times were about 11 minutes for Sol and 10 minutes for Terra. Each missed an explicit task requirement and neither candidate was adopted unchanged. Both judges agreed on the combination; this is a task-specific comparison with one sample per model.
