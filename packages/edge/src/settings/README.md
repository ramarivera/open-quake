# Settings and local onboarding

`SettingsRepository` is the sole owner of the existing private `settings-v1.json`
document. Locale, general preferences and wizard progress share its revision,
semaphore and atomic storage adapter. Do not instantiate another repository over
the same path. `settings-contracts.ts` and the existing locale RPC remain compatible.

General preferences and wizard progress are additive, individually versioned v1
sections. Missing sections get read defaults without rewriting existing files.
Unknown document and section fields survive updates. Unsupported versions,
malformed documents and inconsistent completion markers fail with catalog errors
and leave the stored evidence intact. Public responses decode allowlisted schemas
and exclude unrecognized fields. The repository returns detached graphs and saves
new state only after the write succeeds. Returning the original transaction draft
means no change; callbacks must return a new graph when changing state.

A transaction's validation remains interruptible. Once persistence starts, the
write and in-memory commit finish together even if the caller cancels. The host
adapter writes a private exclusive staging file, syncs it and renames it atomically
with no subsequent fallible filesystem operation before acknowledging success.
The existing adapter does not sync directory metadata. These checks establish
atomic process-level persistence, not hardware power-loss acceptance.

## Root composition

Keep the runtime in `apps/desktop/src/main/settings/registration.ts`. Supply one
`SettingsRepository.Default` over `desktopSettingsStorage(directory, osLocale)`
and provide that shared layer to these conductors:

- `SettingsService.DefaultWithoutDependencies`, the existing locale API.
- `GeneralSettingsService.DefaultWithoutDependencies`, with `SettingsOsPort`.
- `WizardService.DefaultWithoutDependencies`, with `WizardOwners`.

`Layer.mergeAll(SettingsService.Default, GeneralSettingsService.Default,
WizardService.Default)` also deduplicates their identical repository dependency
inside one layer graph. Separate ManagedRuntime instances do not share that memo.
The parent owns root composition, export maps, IPC authentication, shutdown and
renderer subscription. Wizard saves may change locale, so the root must publish
the canonical locale/revision after a successful save just as for `setLocale`.
`backend-rpc.ts` supplies Schema-first requests separately from the unchanged
locale group. Reuse the existing main-frame authorization and bounded pending
request handling. Do not expose raw repository documents through IPC.

## General preferences

`save(GeneralPatch)` validates, persists requested preferences, and applies login
only when the patch explicitly contains `launchAtLogin`. Start-hidden never
mutates login items. A successful login call requires matching OS readback;
unsupported, denied, timed-out and unverified application report
`QUAKE.SETTINGS.OS_APPLY_FAILED` with a fixed reason. Saved intent survives an OS
failure. `snapshot()` returns saved intent, while `loginStatus()` returns the
current confirmed OS boolean or a typed failure. A checked login control must use
that live status and keep any apply failure visible.

`startup()` returns a plan rather than opening or hiding windows. It never
changes login items. A hidden plan requires a currently reachable root-owned
tray/menu/application action. Failed reachability probes produce a visible plan.
Saved bounds are clamped into connected display work areas, including negative
coordinates; no displays means no guessed bounds. The parent applies the plan to
its existing management window. OS calls and owner probes have two-second bounds.
`createSettingsOsAdapter` takes injected app/screen methods with AbortSignals;
constructing the adapter performs no native operation. Cancellation aborts the
request, but a native API that ignores abort may have an unknown late side effect.
Requery login state rather than treating cancellation or timeout as rollback.

## Wizard

`snapshot()` loads resumable progress. `save(WizardDraft)` stores the step and
choices without installing runtimes or creating profiles. Locale/region are
explicit choices. Profile IDs are deduplicated. `seedRegion(region)` initializes
local advisory suggestions once and never selects a model/provider or overwrites
explicit settings. The root must return only suggestions supported by canonical
provider/speech owners; an unsupported suggestion remains absent.

`complete()` requires confirmed locale, region, a display choice and usable
profile IDs. The injected owners revalidate the selected QUAKE identity and
profiles. Explicit desktop preview needs no hardware. Supported optional runtime
setup must be configured or explicitly skipped; unsupported runtime steps do not
block local use. Completion and its step share one durable document write. Failed
writes leave the running wizard incomplete. Repeated completion is a no-op;
`replay()` is the explicit action that reopens setup, preserving all choices and
profiles. No onboarding API creates duplicates. Hardware verification always
remains false here; local completion does not establish physical acceptance.

Provider configuration, model constraints and protected credentials remain with
`AgentsService`/`AiRepository`, `createModelCredentials`, and speech settings.
This domain never reads, stores or resolves secret values. Settings/wizard replies
contain no provider records or credential references. No extra logger or credential
store is introduced; named Effect spans use fixed names without user data.

## Verification limits

Deterministic consumer tests cover denied writes, corrupt documents, shared
locale/general/wizard concurrency, restart/resume/replay, failure atomicity,
private causes, cancellation, OS readback/timeout and reachability. Real file
restart/corruption tests and OS adapter tests live under desktop settings.
Property tests verify bounds always fit a connected work area and repeated
correction is stable. Native login/menu/window acceptance, renderer controls,
profile creation and physical onboarding remain parent-owned acceptance work.
