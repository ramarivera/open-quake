# Task 1.8 Windows foreground helper

Status: implementation and offline verification complete in this lane. Task 1.8
and `open-quake-lih.9.1.8` remain open for production composition and native Windows
identity, latency and CPU acceptance. No native Windows test ran.

Base: `bf03bcde9ca9f5b02462d47d2f44bfa27b8435b0` on `redesign/opus-led`.
Scope: desktop main foreground adapter, helper and their tests. This lane didn't
edit `profiles/index.ts`, `main/index.ts`, emoji, knobs, RPC contracts, shared
schemas, dependencies or CI. Parent owns production composition and delivery.

## Behavior

`makeForegroundProbe("win32")` creates a lazy persistent PowerShell helper.
`Add-Type` compiles the fixed user32 interop before the stdin loop, once per
child lifetime. Numbered newline-delimited requests receive JSON replies with
the same request ID and a foreground identity, absence or fixed error status.
The script uses UTF-8 pipes and disposes each queried process object. It never
returns window titles or native error messages.

The probe keeps the existing inclusive 500 ms result cache, including absence.
Concurrent callers share one pending request. Requests have a 5000 ms deadline
including helper startup and compilation. Combined stdout/stderr output is
bounded to 64 KiB per request and while idle. Stdout parses complete UTF-8
frames; malformed frames, wrong IDs, pipe failures, unexpected output, overflow
and crashes retire the child. A replacement cannot start until the old child
emits `close`. Lookup failures keep the compiled helper available for retry.

Disposal rejects outstanding work, ends stdin, terminates the child and awaits
actual `close`, with an independent 5000 ms shutdown deadline. It is idempotent,
never restarts a child and removes listeners when the child closes. Failure to
close is reported rather than treated as successful teardown.

The Effect boundary retains `ProfileForegroundFailed` and
`QUAKE.PROFILE.FOREGROUND_FAILED`. Native causes remain private; serialized
errors use the existing bounded scrubber. `ForegroundApp.probe` records only
platform and cache-hit attributes, never application paths or window IDs.
Acquisition and release have named spans.

## Parent integration

Prefer `makeScopedForegroundProbe(platform)`, which returns
`Effect<ForegroundProbe, never, Scope>`. Acquire it inside the managed runtime's
`Layer.scoped(ProfileSwitchingPort, Effect.gen(...))` and preserve the mock
branch returning `Option.none()` without native acquisition. Runtime disposal
then awaits helper release.

The compatible `makeForegroundProbe` factory still returns a callable, with
an added `dispose(): Promise<void>`. Owners using it directly must await that
method during teardown. `emoji/index.ts` also constructs a foreground probe
and needs that disposal integration. `nativeForegroundApp` remains a one-shot
utility, used by the existing macOS smoke; persistent consumers should use the
probe factories.

`ForegroundApp.probe` is already a known diagnostics span. Parent may register
`ForegroundApp.acquire` and `ForegroundApp.dispose` in the diagnostics allowlist
to retain those names; otherwise the existing privacy filter redacts them.
No RPC, domain-schema or dependency changes are required.

The early and final seam is recorded in
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-finish/windows-foreground/ready.json`.

## Offline verification

All commands ran with
`TMPDIR=/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-finish/tmp`.

- `pnpm --filter @open-quake/desktop exec vitest run src/main/profiles`:
  67 tests pass across 10 files, including 32 new protocol/adapter regressions.
- `pnpm --filter @open-quake/desktop typecheck`: passes.
- `pnpm exec biome check` on the five owned TypeScript files: passes without
  warnings or fixes.
- `openspec validate profiles-manager-parity --strict`: passes.

The tests drive `ProfileSwitching` and `ProfileManager` with the default Windows
probe and fake process streams. A linked executable identity causes real
outbound profile delivery after debounce. An unmatched identity retains the
selection. Assertions prove the old `execFile` route wasn't used and only one
PowerShell spawn occurred. These are consumer regressions, not just helper
construction checks.

Other regressions cover split UTF-8 and CRLF, consecutive request IDs, shared
in-flight work, interrupted waiters, cache expiry, absent foreground, deadline,
malformed/mismatched replies, stdout/stderr bounds, lookup and pipe failures,
spawn/write exceptions, backpressure, crash/restart, cause privacy, named spans,
lazy acquisition, actual close waiting, shutdown deadline, termination failure,
listener release and scoped interruption.

Logs are under
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-finish/windows-foreground/`:
`profiles-tests.log`, `typecheck.log`, `biome.log`, `openspec.log`.
No live app, native foreground/input, hardware, provider or microphone test ran.

## Native Windows prerequisites and remaining acceptance

Parent must authorize the native run. It requires a Windows interactive user
session with visible test applications, the project's supported Node/Electron
runtime, `powershell.exe` on PATH, user32.dll, .NET C# compilation via `Add-Type`,
and policy permitting that fixed script. No execution-policy bypass is added.
A service/session-zero or locked desktop cannot establish foreground identity.
Access to another process's executable path may fail for protected applications;
those cases must exercise the fixed typed failure and retry behavior.

On each supported Windows architecture, verify actual window handle and
executable path identity for two applications, Unicode paths, no foreground,
rapid focus changes and process exit during lookup. Measure cold startup,
warm uncached requests, cache hits, steady polling CPU and process count;
confirm compilation occurs once per helper lifetime. Exercise crash/restart,
deadline and teardown with real children, and confirm no orphan PowerShell
remains after profile/emoji runtime disposal. Preserve these measurements before
checking task 1.8 or closing its bead. No latency or CPU target is claimed here.
