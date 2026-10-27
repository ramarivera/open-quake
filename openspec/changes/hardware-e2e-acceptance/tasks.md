## Implementation

- [x] 1.1 Add the bounded scenario consumer, dedicated native opt-in and restoration/coverage regressions.
- [x] 1.2 Build current main and run existing hidden native/mock UI and bundle checks.
- [x] 1.3 Execute the safe opted-in native suite, inspect retained diagnostics and report exact scenario coverage.
- [x] 1.4 Ship the suite with one PR review round and preserve explicit physical-only limits.

Execution issue `open-quake-fdc.1`; supervised keyboard execution is `open-quake-fdc.2`. Existing physical acceptance stays in `open-quake-l86.7`.

The clean native control suite at ca10a267 passed 13/20 declared control/session scenarios, 65%, with queried restoration of microphone, luminance and knob LED. It retained 163 records, 160 spans and 159 local parent links, with no drops, storage failures or redacted spans. This is not whole-product coverage. First-round review findings are resolved; hosted validation, all five platform packages and complete download matrix passed at that revision, with publication skipped. No additional review round was requested.

Live keyboard testing then exposed the fixture's own Chromium helpers being mistaken for competing device owners. The process-tree regression failed before the fix and passes afterward, while independent owners stay blocked. A second live issue allowed Electron to exit before async cleanup; the fixture now delays quitting and finalizes its result only after runtime, diagnostics and owner cleanup. The dedicated target observed the real device type one a and release KeyA. The completed run retained 26 diagnostic records; no fixture processes or owner lock remained. The 22 focused acceptance/report regressions and owning typecheck pass. Source delivery for these live-test repairs remains pending.

Keyboard evidence is supplemental. The background suite stays at 13/20, and the additional keyboard scenario has now been exercised. Touch, knob gestures, physical USB hot-plug, visible panel output, audio/provider behavior and lighting qualification remain unverified. Ramiro reported an unlit/blank QUAKE during tests; macOS detects DK-QUAKE online at 1920x480, but those tests do not render the product panel. The observation is tracked in `open-quake-l86.7`.

Build outputs and raw run artifacts remain in owned SSD scratch, outside git. The hidden native UI smoke passes but does not claim full-shell acceptance. No firmware flashing occurred. Ramiro waived repeated local test focus/readiness requests for the Mac mini during this task.


## Expanded automation

Baseline PR135 squash merged as a37a5172 after exact-head review and all hosted checks passed. Execution issue `open-quake-fdc.3` owns this extension.

- [x] 2.1 Add and exercise native lighting restoration, concurrent query and software reconnect checks with fake regressions.
- [x] 2.2 Add and execute real USB microphone capture, pause/resume and cleanup checks through the production driver.
- [ ] 2.3 Reconcile actual additional coverage, ship the extension and handle one review round.


Native supplemental results passed concurrent queries, twelve software reconnect cycles,13/13handle cleanup and V3 effect-speed restoration. Six legacy-lighting checks are retained as skips on the installed3:1.0.19/protocol12 identity. Readback experiments established that brightness/color are not yet byte-for-byte controls and the repeatable write guard blocks them. The original observed247brightness/off0mode was restored after qualification. Real USB capture passed twice with ordered PCM, pause/resume, short final frames, stop and worker cleanup, plus low-level native output and playback drainage. No raw audio was saved. Production V3 capability-schema approval remains a separate pending question; the test extension can ship independently.

## Approved narrow V3 production control

Execution issue `open-quake-fdc.4`. Ramiro approved the schema change.

- [x] 3.1 Add the exact hardware-qualified V3 speed capability and shared-owner mapping, with unsupported operations rejected before IO.
- [x] 3.2 Verify capability/schema, production consumer, renderer and actual native speed application/restoration.
- [ ] 3.3 Ship the narrow fix separately with at most one review round.

Narrow V3 implementation verifies exact identity, scalar descriptor3, shared prefix[3,3], unsupported edits/save before IO and disabled renderer save. Native production run passed8/10 supplemental checks with2 explicit unsupported fields, speed restored156, original brightness247/mode0 retained,13/13 handles closed and538 safe diagnostics with zero drops/failures. Physical illumination remains unverified.
