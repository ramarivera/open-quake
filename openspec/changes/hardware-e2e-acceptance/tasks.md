## Implementation

- [x] 1.1 Add the bounded scenario consumer, dedicated native opt-in and restoration/coverage regressions.
- [x] 1.2 Build current main and run existing hidden native/mock UI and bundle checks.
- [x] 1.3 Execute the safe opted-in native suite, inspect retained diagnostics and report exact scenario coverage.
- [ ] 1.4 Ship the suite with one PR review round and preserve explicit physical-only limits.

Execution issue `open-quake-fdc.1`; existing physical acceptance stays in `open-quake-l86.7`.

On 2026-10-27 the actual Mac mini QUAKE passed all thirteen automated control/session scenarios out of twenty declared scenarios, 65%. Microphone, luminance and knob LED round trips each included native query readback and restoration. Seven physical or supervised scenarios remain. The native run retained 159 records, 157 spans and 156 local parent links with zero drops or storage failures. These figures do not claim whole-product coverage. The dedicated keyboard fixture is compiled and awaits fresh local readiness.

Fresh main build, both bundle modes, owning typecheck, seven suite regressions and ten retained-diagnostics tests pass. The hidden native UI smoke also passes; its unrelated shell IPC stubs remain incomplete and are not full-shell acceptance. Test fixtures now resolve resources relative to the built script and avoid Dock activation. Run artifacts remain in SSD scratch, outside git.

PR135's first review batch fixes the user-writable default for fake tests, validates diagnostics before atomic result replacement, rejects replacement serials at each transport open, and distinguishes the fixture's launcher ancestors from independent owners. Lock cleanup preserves a replacement owner. Sixteen acceptance/report regressions and ten hardware diagnostic tests pass, as do desktop typecheck and keyboard fixture compilation. The updated background native suite again passed 13/20 with zero diagnostic drops or storage failures; its source hash identifies the uncommitted review-fix source. Original-head Ubuntu validation confirmed the portable-scratch finding with two EACCES failures. First-round review and corrected-head hosted checks remain pending.
