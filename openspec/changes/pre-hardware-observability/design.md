## Approach

Use pinned Effect 3.22.1 APIs. Reuse the process-owned diagnostics layer, privacy projection, bounded storage and retrieval path. Domain methods use named Effect.fn spans and Effect logging. Logger/tracer lifecycle belongs at runtime roots. Any Pino bridge consumes projected facts, preserves actual trace/span/request correlation, and cannot replace original product errors when storage fails.

Record hardware failures before safe rejection/recovery. Delayed callbacks retain only correlation metadata. Never retain raw input, profile content, transcripts, provider URLs, credentials or arbitrary exception text. Cancellation and shutdown report their actual outcome.

Run two identical Sol/Terra candidates per task on the same source revision, locally only. Independent Opus and Meta Wonder Full judges inspect them before parent integration. Scope is two useful repairs, not a generic tracing framework.

## Hardware candidate decision

Both independent judges, Opus 5.5 and Wonder Full, selected Sol's hardware candidate. Terra's candidate left lighting's separate runtime and production promise-error identity uncovered. The integration guards interruption-only desktop causes, records an owned key failure once before the completion join, and uses an optional parent span for deferred completion. Catalog identity recovery can return the original action code to the renderer instead of the previous generic host-action code.

This was one run per model per task. Hardware elapsed times were about 21 minutes for Sol and 5 minutes for Terra, with different completeness. These runs don't establish general model quality or equal-scope speed, and no cost comparison is available. Physical hardware remains unverified.
