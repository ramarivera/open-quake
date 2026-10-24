# Late management review findings

This refresh supersedes the earlier final-source identities in the base and
top round reports. Parent owns final-head acceptance and ordered merges.

A bounded metadata check identified a newer Codex review on PR33 head
`1d662ce085701afa9b012a129bf7d78e3ae0f1f4` with four inline findings.
All four were independently confirmed, tracked in Bead
`open-quake-lih.17.1.32` and OpenSpec task 7.9, and strictly planned before code.
Fresh thread evidence is `pr33-late-new-review-threads.json` under the
existing review-round-1 evidence root. No reviewer was triggered or polled.

Production fixes are in `6802969`. Final verified base source is
`0ac9ed54aa4a6fd43ab83c7411198002bf9b7495`, including typed test/harness
corrections and saved-state viewport capture waits. Main
`85f1e3bacc49e16f2965f614a5ce2a38f6eb3e06` remains included normally.
All shared owners, successful-release routing and awaited shutdown remain.
No restricted maintenance source was read or changed in this continuation.

| Thread | Confirmed correction and regression |
| --- | --- |
| `PRRT_kwDOUADXpM6v6RuD` | Only a missing entity state endpoint maps 404 to an unavailable entity. Successful sibling state reads survive. A real synthetic loopback HTTP test drives the actual HomeAssistantService through connect, mixed polling and a healthy action. 500 and 403 still fail with their proper identities; other endpoint 404 remains a network error. |
| `PRRT_kwDOUADXpM6v6RuI` | Choosing Not set removes the service-data property. Native Chromium selects an optional effect, clears it, saves through preload/production IPC and verifies the committed key has only its required brightness. |
| `PRRT_kwDOUADXpM6v6RuK` | Three-way slot reconciliation preserves pending choices across unrelated snapshots, adopts committed changes to untouched slots and discards deleted-agent drafts. Pure regressions cover reconciliation; native Chromium changes a slot, saves models and roles in another tab, returns to the retained choice and syncs it through production IPC. |
| `PRRT_kwDOUADXpM6v6RuN` | Shortcut sync uses the shared visibleProfiles count. A production repository regression fills 30 stored profiles with a hidden built-in, successfully syncs the remaining visible slot, rejects the next addition without mutation, and still permits resync. |

All six fresh gates passed on source 0ac9ed5. Manifest:
`pr33-late-capture-final-gates.json`, with corresponding individual logs.
Tests passed 1525 across 165 files: desktop 857/105, edge 218/22, device 390/34,
protocol 60/4. Both bundle modes passed; strict OpenSpec passed 39 items.
Turbo used explicit `--env-mode=loose --concurrency=1` and tests used
`--maxWorkers=2`, existing absolute owned ExtSSD TMPDIR and mock device mode.

Final real Electron mock proof is
`pr33-late-capture-native-n7xi5ihn/proof.json`, with
`pr33-late-capture-native-{build,run}.log`. All eight hashes match. The
optional select and pending slot images were inspected at full size;
`pr33-late-capture-audit.json` records saved-state and viewport waits.
The prior ownership, AI/direct capabilities, model draft retention, scoped
DK-Claw, shortcut selection and awaitable-disposal checks also passed.
Production runtime/AI adapters remain unavailable. No hardware, packaged
application or real clipboard/paste acceptance is claimed.

Retained retries and warnings:

- The first targeted run passed the behavior assertions but failed two
  error checks against Effect's outer FiberFailure. Tests now inspect the
  underlying typed cause. Logs: `pr33-late-targeted.log` and
  `pr33-late-targeted-green.log`; all 15 targeted tests passed.
- First forced typecheck rejected unbranded slot fixtures and a generic
  generated manager accessor in the native harness. Schema decoding and
  direct service-tag access fixed these. No production validation weakened.
  Log: `pr33-late-final-typecheck.log`.
- An unpublished amend emitted an Entire prepare-commit-msg usage error
  but completed through the normal hooks. The owned gate runner was
  interrupted conservatively while checking that state, and its exact
  runner plus five descendants were stopped. The clean full rerun passed.
  Audit: `pr33-late-rejected-gates.json`; interrupted logs remain.
- Source 6d6d393 passed all six gates and native IPC, but its optional-field
  capture cropped the select below the viewport. The image was rejected
  for field proof in `pr33-late-initial-capture-audit.json`. Explicit scroll
  and viewport waits fixed the capture; all six gates and native proof
  were refreshed again on source 0ac9ed5. The earlier successful manifests
  and captures remain retained as superseded evidence.
- Chromium local cache warnings remain in native logs. Hook configuration
  and parent/other-lane processes were untouched.

Task `.32` remains in progress until this verified base is normally merged
into PR34 and the top receives fresh six-gate and native proof. Epic
`open-quake-lih.17.1`, physical acceptance `.23` and real-app paste `.26`
remain open. Automatic final-head review remains pending/unverified.
