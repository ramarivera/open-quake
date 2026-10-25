# Task 1.8 Windows foreground helper

Status: implementation, offline verification and native Windows x64 helper
protocol/lifecycle acceptance pass. Task 1.8 and `open-quake-lih.9.1.8` remain
open for interactive desktop identity and foreground-present measurements.
The native run below used SSH session 0 and observed foreground absence only.

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

Interactive identity acceptance requires a Windows interactive user
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

## Parent composition

The production Profiles layer now acquires `makeScopedForegroundProbe` through a scoped layer. Mock mode creates no native helper. Emoji awaits foreground disposal after runtime disposal, including runtime disposal failure. Combined parent source passed 1,380 desktop tests, desktop typecheck, production build and scoped Biome. Native Windows evidence remains separate; this macOS integration does not establish Windows identity, latency, CPU or teardown.

## Read-only native Windows acceptance, 2026-10-25

Parent authorized bounded read-only SSH acceptance after reporting integration
as `2fe7a93`, scoped profiles acquisition, awaited emoji disposal and diagnostic
span names. SHA-256 comparisons confirm all three foreground source files in
this lane match `2fe7a9353349a9d2ed3f38dfb6932079644f7761`. This lane made no
parent composition edits and leaves aggregate closure and delivery to parent.

`ramar@zeph` passed BatchMode SSH with an eight-second connect deadline.
Prerequisites were Windows AMD64, x64 Node `v20.12.1`, Windows PowerShell
`5.1.26100.9711` and the existing FullLanguage mode. The SSH process ran in
session 0 with `UserInteractive=false`; Explorer ran in session 1. No session
bridge, foreground activation, input, policy/auth/grant change, installation,
update, application launch, microphone, provider or hardware access occurred.
Only scratch Node/PowerShell processes ran, with hidden windows.

The committed adapter, helper, script and existing Effect dependency were
bundled locally with the already-installed Vite, targeting Node 20. The bundle
and a scratch-only harness were transferred into
`USERPROFILE/dev/agentic-scratchpads/open-quake/foreground-20261025`.
The main harness set TEMP/TMP to that directory before compilation and used a
50-second watchdog. It exercised the actual fixed Add-Type script and production
probe factories without installing remote dependencies. It persisted only
status counts, measurements and cleanup results, never foreground paths,
window handles or titles.

Native measurements on this host, all for the absent-foreground branch:

| Check | Result |
| --- | --- |
| Cold helper request including compilation | 741.65 ms |
| 30 warm uncached requests | median 0.467 ms, p95 0.803 ms, max 1.301 ms |
| 25 actual adapter cache hits | median 0.118 ms, p95 0.391 ms, max 1.108 ms |
| 5 reads at two-second intervals | 10,047.22 ms elapsed, 15.625 ms helper CPU |
| CPU sample | 0.156% of one core, with Windows timer granularity |
| Real child request deadline | 5010.33 ms |
| Awaited child disposal | 7.58 ms |
| Foreground observations outside cache loop | 39 absent, 0 present |
| Maximum simultaneously tracked children | 1 |
| Final native process enumeration | 0 helpers, 0 harnesses, 0 transfers |

The first helper answered 36 numbered reads in one process, with Add-Type
before its request loop. Killing that owned child and awaiting close caused
one replacement, which answered the next request. Repeated default-adapter
cache calls left its native write count at one; refreshing after 550 ms raised
it to two. The scoped default factory released its real child on finalization.
A real silent Node child supplied through the existing process seam hit the
five-second helper deadline and was terminated. This deadline test used a real
pipe/process boundary but did not suspend or delay a live foreground process.
Awaited disposal was idempotent and later probes rejected without respawn.

An independent fixed user32 check confirmed `GetForegroundWindow()==0` in
session 0. This establishes correct native absence handling. It cannot
establish the executable/window identity on the user's desktop in session 1.
No external two-app transition occurred. These latency and CPU numbers must
not be presented as measurements of the foreground-present Get-Process path.
ARM64, Unicode executable paths and interactive identity remain unverified.

`ramar@zaph` failed with `ssh: connect to host zaph port 22: Operation timed out`
at ConnectTimeout=8. Before retrying, Tailscale status confirmed ZAPH offline,
last seen `2026-09-28T20:12:10.1Z`; no unchanged retry followed. ZEPH stayed online.

The first large bundle transfer succeeded. The stdin transfer of the smaller
harness timed out after 25 seconds before creating that file. A read verified
the side effects, then SFTP transferred the remaining harness. A final separate
process enumeration found one stalled owned transfer PowerShell, matched its
exact encoded command, terminated only that process and confirmed zero
remaining transfer/helper/harness processes.

Deviation: the first standalone cleanup/absence comparator inherited Windows'
default TEMP/TMP, unlike the main acceptance harness. The final comparator set
both to the approved scratch before Add-Type. No policy or permission change
was used. A bounded top-level default-TEMP inspection of recent source, assembly,
debug and compiler-command files up to 256 KiB found zero candidates and no
matching comparator artifacts. It did not scan unrelated directories.

Evidence is under the approved local `windows-foreground` scratch directory:
`zeph-prerequisites.json`, `native-build.log`, `native-harness.cjs`,
`native-bundle/foreground.cjs`, `zeph-native-result.json`,
`zeph-native-transport.json`, `zeph-native-cleanup.json`,
`zeph-comparator-artifacts.json` and `ready.json`.
The Windows scratch contains `foreground.cjs`, `native-harness.cjs` and
`result.json`. Run logs and harness artifacts stay outside git.

Task 1.8 and its bead remain open. Parent owns any authorized interactive
session route, native foreground-present measurements, architecture coverage,
production acceptance and aggregate closure.
