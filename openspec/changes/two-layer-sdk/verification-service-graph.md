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
Only graph finalization releases the capture port and audio IPC. Registration
teardown suspends capture without releasing those resources. Preparation installs
no listeners, and repeated cleanup is idempotent.
This does not open a capture window, microphone or provider.

## Verification, 2026-10-26

- The affected domain and root tests passed, 550 tests across 86 files.
- After merging the saved-model shortcut drafting change, the full desktop
  suite passed, 1643 tests and one existing skip. External TMPDIR avoids the
  host's backup symlink issue.
- The final focused ownership, diagnostics, settings IPC, meeting shutdown and
  shortcut deadline tests passed, 34 tests. Desktop typecheck passed.
- Production build and bundle smoke passed. The bundle exercised default HID
  absence, development mock selection and awaited quit without hardware I/O.
- The unmodified direct-chat native smoke passed against the actual root,
  preload and React UI with isolated settings and synthetic loopback inference.
  Captures at 390 and 1180 were produced. The 390 capture was inspected and
  showed the newest reply, completion metadata and composer in view.
- Native smoke windows were opacity zero, non-focusable and click-through;
  show and focus methods were disabled before the root created consumers.
- The actual-root shortcut smoke passed after the drafting merge. It checked
  saved-model drafting, cancellation of an active stream during quit and
  byte-identical saved profiles. It logged one transient missing
  `maintenance:request` handler at startup. Root registration currently follows
  renderer creation; task 2.9 retains fixing and verifying activation ordering.
- The native media smoke passed image decoding, panel mutation permissions,
  preload/IPC, image fill modes, clock synchronization, reduced motion, touch,
  profile grids and awaited runtime disposal. Its exact Paper background
  expectation changed from the old `#f6f4f0` to the merged canonical `#f5f4f1`
  token. No renderer styles changed. This media-only fixture does not register
  settings or agent handlers and logs their absence; it is not console-clean.
- Scoped Biome, strict OpenSpec validation and diff whitespace checks passed.

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
The native runs are `direct-smoke/direct-chat-O805XE`,
`shortcut-smoke/shortcut-draft-pEc9F2` and `media-shots`. The merged suite,
final focused tests and media results are in `desktop-merged.log`,
`merge-focused-final.log` and `media-native-3.log` respectively.

## Remaining acceptance

Merge all root layers, supply prepared execution views, include the HTTP registry
and knob, remove the other production main-process runtimes, and repeat
actual-root active-work shutdown plus media/bundle acceptance on that graph.
Preload and isolated test
runtimes are separate process or fixture owners. Hardware, microphone and live
provider behavior are not established by this change.


## PR72 review corrections

Registration teardown suspends capture and
interrupts its publisher without releasing the graph-owned capture port or
shutting down the shared service PubSub. Only graph disposal releases the port.
The shared-owner regression calls the service successfully after registration
teardown, then observes exactly one port release at owner disposal. Early request,
chunk and PCM handlers wait for acquisition; request authorization still runs
before the wait, and acquisition failures retain the typed meeting error reply.
Four regression assertions failed against the previous implementation. After the
fix all 26 meeting desktop tests, desktop typecheck, scoped Biome and strict
OpenSpec validation pass. No native audio or hardware acceptance was run here.

PR72 shared-resource corrections, 2026-10-26: conversation registration teardown
now cancels only its controller work. ConversationService owns its shutdown as
a graph finalizer, so another consumer can still stream after registration
teardown. Emoji's foreground probe is acquired by a scoped adapter layer and
released only when that layer closes. A second consumer can use EmojiPress
after registration teardown, while a retained service fails with the typed
foreground error after application disposal. The probe test injects a synthetic
native reader and performs no foreground inspection or OS input. Both focused
suites passed, 18 tests; the two new regressions fail against the previous
commit in a scratch checkout. Desktop typecheck passed.


PR72 retained-capture and integration corrections, 2026-10-26: meeting audio
chunk, PCM and source-loss IPC now shares the graph-owned capture lifetime.
A retained Effect execution context dispatches capture work through a private
scope after registration disposal and while the graph finalizer drains capture.
The finalizer suspends capture, waits for its final write, then removes audio
handlers, joins capture work and releases the port. Only standalone meeting
registration installs a quit veto; prepared registration leaves quit to root.
Home Assistant and channel QR session cleanup now belongs to their scoped
service finalizers. Registration disposal retains its own timers, draft
cancellation, publisher and pending-operation cleanup without disconnecting a
second consumer's services.

The meeting regression starts translation and recording after registration
teardown, then blocks the final chunk write during graph disposal. Handlers
and the port remain alive until that write completes. The integration regression
keeps a Home Assistant connection and pending QR session usable after
registration teardown, then checks each is released exactly once by the graph.
Both regressions fail against 2d114ae in a scratch archive. The focused meeting
and integration suites pass, 54 tests. The preparation edge suite passes,
647 tests with three existing skips. The full preparation desktop suite passes,
1650 tests with one existing skip, and both typechecks pass. These checks
use synthetic ports and isolated stores; no microphone, HID or OS input runs.


PR72 failed-capture and firmware-access corrections, 2026-10-26: a failed
capture acquisition has no resource finalizer, so registration disposal now
removes the audio IPC handlers and closes its unused capture scope explicitly.
Successful acquisition retains the existing graph-owned lifetime. Firmware
security-scoped access is now owned by the scoped FirmwarePort layer, which
closes after its dependent firmware worker. Registration teardown can no longer
release access during the settle delay or an in-flight uninterruptible copy.
The existing bookmark suite now exercises both standalone and shared owners.
Three assertions fail on 58764b3 and pass after the correction, including
registration disposal before copy opens the destination and graph disposal
waiting for an in-flight copy. All 153 desktop maintenance/meeting tests,
desktop typecheck and scoped Biome pass. Ports are synthetic; no actual drive,
firmware write, microphone or hardware acceptance is claimed.
