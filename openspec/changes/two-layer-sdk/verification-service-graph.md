# Desktop service graph verification

Task 2.9 is implemented and locally verified. Reviewed PR delivery is pending,
so its checkbox and bead open-quake-l86.10 remain open. Preparation is PR72;
the production graph integration is stacked above it.

## Production ownership

The root merges the prepared domain layers and creates one ManagedRuntime.
The graph includes hardware, wallpaper, clock, monitoring, weather/system media,
profiles, agents, direct chat, HTTP connections/registry/conversations, voice,
emoji, settings, meetings, lifecycle and maintenance. Every prepared view is bound
to that owner. Graph acquisition precedes IPC activation, and both renderers load
only after registration. Recreated panel and management windows load normally.
Direct chat's execution-only host is constructed before acquisition so the voice
layer can reference it; it activates no IPC or worker at that point.

Each prepared execution view owns a closeable registration scope. View disposal
interrupts and joins its asynchronous work, including delayed finalizers, while
leaving services available to other consumers. Caller interruption joins its child
operation. Explicit standalone wrappers additionally dispose their own runtime.
HTTP conversation registration cancels only controller work; the conversation
service shuts down at graph finalization. Emoji's foreground probe belongs to a
scoped adapter layer. Meeting capture and PubSub likewise remain graph-owned.

Wallpaper delegates quit ownership to the root. Root shutdown stops producers,
tries every ordered cleanup even after a failure, closes registration execution
scopes and awaits application finalizers before closing diagnostics and quitting.
Firmware shutdown blocks new work and joins the worker before bookmarks release.
Reset/import stop writers, settle their request, close their execution view,
dispose the application and exit. The background view closes after shutdown work
returns, avoiding interruption of its own shutdown request.

Settings, chat, meeting and firmware repositories defer reads until service
operations. Serialized initialization publishes only successful state and retries
failed reads. Corrupt feature data cannot fail acquisition of the whole graph.
HTTP connection construction still produces its existing unavailable response.

## Automated verification, 2026-10-26

The integrated full suites passed 1,651 desktop tests with one existing skip and
652 edge tests with three existing skips. The desktop run uses an external TMPDIR
because this host's default temporary directory resolves through a symlink.
Desktop and edge typechecks, production build, scoped Biome, strict OpenSpec
validation and diff whitespace checks passed.

Focused ownership tests prove shared service identity/state, exact catalog failure
identity, caller cancellation, registration interruption with a delayed finalizer,
late-call refusal, standalone cleanup and application finalizer ownership.
Root tests assert one runtime owner, IPC activation before renderer loading,
replacement-window loading, one quit handler, cleanup continuation after failure,
and waiting for application disposal. Firmware tests prove shutdown prevents a
delayed copy from starting. Repository tests cover corrupt reads without writes,
retry and concurrent initialization/crash recovery.

PR72's conversation and emoji regressions fail against the previous commit in a
scratch checkout and pass with the service-owned finalizers. The emoji check uses
a synthetic native reader; it performs no OS foreground inspection or input.

## Built application acceptance

All Electron acceptance used isolated user data, mock hardware, hidden opacity-zero,
non-focusable, click-through windows, with show/focus disabled. No microphone,
physical device, live provider or OS preference mutation was used.

- Bundle smoke passed HID-absent and explicit mock modes, including awaited quit
  without native discovery or device I/O.
- The unmodified actual-root direct-chat smoke passed saved model selection,
  preload/RPC, React conversation behavior and live locale broadcasts. The true
  390px capture was inspected: latest reply, completion metadata and composer fit.
- The actual-root shortcut smoke passed saved-model drafting, cancellation of an
  active synthetic response during quit and byte-identical saved profiles.
- A hidden normal-build launcher seeded malformed settings, chat, meeting and
  HTTP connection files together. Management loaded, affected feature reads failed,
  maintenance remained usable, all four original byte sequences remained intact,
  no missing-handler error appeared and normal quit completed.
- Normal-build maintenance export, import and reset passed through real preload
  and root registration using synthetic native-dialog responses. Import reported
  success and exit zero, retained nine profiles and restored saved settings.
  Reset exited zero and removed the synthetic marker and profile file.
- Native media smoke passed image decoding, mutation authorization, real preload
  and IPC, fill modes, clock synchronization, reduced motion, touch and profile
  grids, followed by awaited runtime disposal. This isolated media fixture omits
  settings/agent registrations and logs their absence; it is not a console-clean
  full-root fixture.

The shortcut/corrupt runs can log macOS task_policy_set invalid-argument messages
after their success markers. One repeated shortcut run logged an intermittent
missing maintenance handler while still passing stream cancellation and shutdown.
An instrumented repeat did not reproduce it; open-quake-buc tracks investigation.
The corrupt-store and direct-chat root runs reported no missing handlers.
A separate existing contextBridge limitation strips class error fields from
locale/direct-chat rejections. General settings preserves its plain-object code,
and meeting/HTTP response values retain their codes. This is tracked separately
as open-quake-ca2; graph error identity is covered at the main-process boundary.

## Evidence and limits

Scratch evidence is under
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-finish/service-graph/`.
Full suites are desktop-graph-final2.log and edge-graph-final2.log. Root cleanup
and execution-view tests, typed repository tests, build/typecheck logs, the
corrupt-root and maintenance-root launchers and native captures remain there.
No generated run artifacts or capture scripts are committed.

Physical hardware, microphones, live providers, runtime containers and packaged
Windows/Linux acceptance are not established by these checks. This change does
not close those separate acceptance tasks or the overall redesign.


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


## PR73 review corrections and repeated acceptance, 2026-10-26

A failed HTTP connection-store acquisition now leaves voice's selected HTTP route
empty so typed text and normalized transcripts reach the direct fallback.
Agent draft adapters may expose late availability; AgentsService checks it on
both views and draft requests. A missing HTTP repository therefore reports
unavailable drafting and returns the existing unavailable code. Explicit HTTP
selection/read failures still fail normally. No schema or bridge changed.
The firmware shutdown span now retains its diagnostic name.

The production meeting quit concern is addressed by parent 15c12c1. The real
prepared-registration test adds no quit listener, and the hidden normal-root
launcher measures exactly one before-quit listener. The graph's capture finalizer
drains an active second consumer's last write with IPC still installed.

The HTTP fallback, late drafting availability and diagnostic-name regressions
fail on the previous integration commit in scratch archives. The current full
desktop suite passes 1654 tests with one existing skip; the edge suite passes
653 tests with three existing skips. Both typechecks, production build, scoped
Biome and all 46 strict OpenSpec items pass. Hosted validation exposed a Linux
test timing bug: waiting for an undefined window type succeeded before the
asynchronous swap. That test now waits for the old window's destruction, then
checks the replacement's type, geometry and renderer URL. All 33 root tests pass
with the hosted worker limit.

Repeated hidden native checks passed the unmodified direct-chat smoke,
active-stream shortcut cancellation, native media smoke, four-corrupt-store
startup, and normal-root export/import/reset. A scratch variant of the direct
smoke additionally seeds a corrupt HTTP file, drives SendText through the real
voice preload, observes a completed response from the saved synthetic direct
model, checks drafting is unavailable and verifies corrupt bytes are retained.
This proves text dispatch through the real root; normalized transcript fallback
is covered through the graph consumer test, not microphone capture.

Evidence is in desktop-reviewed-final.log, edge-reviewed-final2.log,
root-ci-timing-fix.log, pr73-review-baseline-{desktop,edge}.log,
direct-native-reviewed.log, corrupt-http-voice2.log, shortcut-native-reviewed.log,
shortcut-phase-reviewed.log, media-native-reviewed.log, corrupt-root-reviewed.log,
and root-{export,import,reset}-reviewed.log under the scratch directory above.
Review delivery and hosted checks remain pending; task 2.9 stays unchecked.
