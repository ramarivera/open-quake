# Desktop service graph preparation

Status: incomplete for task 2.9. The production root still uses independently
owned module runtimes. This change supplies the preparation/activation interface
for the root integration, without claiming the single application graph exists.

## Implementation

`prepareDesktopModule` exposes a layer, an execution view, binding and activation.
Binding never constructs a ManagedRuntime. An application can merge prepared
layers, bind every view to one owner, await acquisition and activate registrations.
The view cannot expose layer memoization or a separate service context. Its
`dispose` only closes a runtime created by the explicit standalone path.

Profiles, agents, direct chat, runtime conversations, integrations, emoji, voice,
settings, monitoring, meetings and maintenance now expose prepared variants.
Their existing registration entry points retain standalone ownership for current
callers. Consumer contracts accept execution views rather than full ManagedRuntime
objects. Registrations retain their worker interruption, pending-operation joins
and IPC checks. The HTTP registry, knob and root composition remain to integrate.

Meeting capture listener acquisition now belongs to its scoped service layer.
Registration teardown and graph finalization share an idempotent release, so
neither preparing a module nor a second cleanup installs or removes listeners.
This does not open a capture window, microphone or provider.

## Verification, 2026-10-26

- The affected domain and root tests passed, 550 tests across 86 files.
- Desktop full suite passed before the final two focused additions, 1630 tests
  and one existing skip. External TMPDIR avoids the host's backup symlink issue.
- The final focused ownership, diagnostics, settings IPC and meeting shutdown
  tests passed, 24 tests. Desktop typecheck passed.
- Production build and bundle smoke passed. The bundle exercised default HID
  absence, development mock selection and awaited quit without hardware I/O.
- The unmodified direct-chat native smoke passed against the actual root,
  preload and React UI with isolated settings and synthetic loopback inference.
  Captures at 390 and 1180 were produced. The 390 capture was inspected and
  showed the newest reply, completion metadata and composer in view.
- Native smoke windows were opacity zero, non-focusable and click-through;
  show and focus methods were disabled before the root created consumers.

The new tests drive both prepared consumers through the same acquired service,
check incrementing shared state, stop one without disposing the owner, hold a
finalizer open to prove awaited application disposal, preserve exact failure
identity and caller interruption, and retain standalone cleanup. The settings
case drives the real preload protocol and registered handler, then reads its
new locale through a second consumer after registration teardown. The diagnostic
case verifies the module operation span and finalizer log reach the owner sink.

These are interface and consumer tests for new ownership behavior. They are not
claimed as before/after regression proof against an existing prepared interface.

Scratch evidence is under
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-finish/service-graph/`.
The native run is `direct-smoke/direct-chat-O805XE`.

## Remaining acceptance

Merge all root layers, supply prepared execution views, include the HTTP registry
and knob, remove the other production main-process runtimes, and run actual-root
active-work shutdown plus media/bundle acceptance. Preload and isolated test
runtimes are separate process or fixture owners. Hardware, microphone and live
provider behavior are not established by this change.
