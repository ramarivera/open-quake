# Tasks

- [x] 1.1 Define model roles and provider thinking/search quirks; test facade dispatch, capability rejection and profile immutability. Bead: open-quake-lih.15.1.1.
- [x] 1.2 Implement corrected speech adapters and owned playback; test fake HTTP/WebSocket, deadlines, cancellation, safe errors and natural drain. Includes open-quake-c5w.13. Bead: open-quake-lih.15.1.2.
- [x] 1.3 Implement Auto classification and typed dispatch preserving explicit modes and follow-ups; test every target, malformed/untrusted output and disabled HA. Bead: open-quake-lih.15.1.3.
- [x] 1.4 Ship retained role prompts and translated names; test exclusions, selection and locale coverage. Bead: open-quake-lih.15.1.4.
- [x] 1.5 Run lane gates, document limits and publish the PR with source and verification evidence. Bead: open-quake-lih.15.1.5.

- [x] 2.1 Correct Kimi mandatory sampling through final facade validation, with snapshot and constraint regressions. Bead: open-quake-lih.15.1.6.
- [x] 2.2 Isolate Auto classification controls and retain daily/deepThink reasoning, with facade regression coverage. Bead: open-quake-lih.15.1.7.
- [x] 2.3 Reject DeepSeek vision-role requests before credentials even when images are advertised, with a regression test. Bead: open-quake-lih.15.1.8.
- [x] 2.4 Bound all recognition protocol phases including stalled sends and prove speech ownership is released. Bead: open-quake-lih.15.1.9.
- [x] 2.5 Run all lane gates after merging main, publish review evidence and reply to/resolve all seven review threads. Bead: open-quake-lih.15.1.10. Final integration verified against main at bdf8ca8.
- [x] 2.6 Cancel knob registration work during integrated shutdown and regress pending profile reads/refreshes without changing the bundle gate deadline. Bead: open-quake-lih.15.1.11.
- [x] 2.7 Accept disabled thinking for DeepSeek Auto classification without provider reasoning options, retain enabled-control rejection, and regress the facade path. Bead: open-quake-lih.15.1.12. Additional thread PRRT_kwDOUADXpM6v33e1.
- [x] 2.8 Fit Auto classification's token budget to the profile, omit unsupported overrides, and regress smaller/absent limits through dispatch. Bead: open-quake-lih.15.1.13. Additional thread PRRT_kwDOUADXpM6v36me.

## 3. Lead acceptance

- [x] 3.1 Inspect source and review dispositions, independently run all six gates with uncached tests, reconcile shared speech acceptance tracking, and verify merge readiness against the reviewed head. Bead: open-quake-lih.15.1.14.

- [ ] 3.2 Accept production speech and Auto consumer integration after owning lanes bind desktop transcripts, audio output, conversation-scoped follow-up routes and target dispatch. Qualify live speech with authorized calls and preserve physical acceptance under the shared hardware checklist. Shared speech tasks remain open. Bead: open-quake-lih.15.1.15.

Lead verification: [lead-acceptance.md](lead-acceptance.md). Implementation and
mock verification do not close production/live acceptance task 3.2.

## 4. Review round 2

- [x] 4.1 Address the five new PR #27 threads on ec013348: preserve GPT-5.1 default and disabled reasoning, assert router error identities, reject preset custom prompts, accept streaming WAV size placeholders and DashScope in-progress finish reasons. Add regressions, integrate main once if advanced, run all six gates, and publish attributed thread dispositions and evidence. Bead: open-quake-lih.15.1.16. Production/live acceptance task 3.2 remains open.

Review-round-2 evidence: [review-round-2.md](review-round-2.md).

## 5. Providers burn-down lane

- [x] 5.1 Complete retained catalog, migration and provider settings. Bead: open-quake-lih.15.2.
- [x] 5.2 Complete dedicated and compatible wire protocols, tools and explicit search. Bead: open-quake-lih.15.3.
- [x] 5.3 Complete offline preflight, terminal defense, diagnostic mapping and opt-in files. Bead: open-quake-lih.15.4.

Implementation and synthetic verification cover the providers lane's 25 rows.
The three beads stay open for lead review and merge. Live provider and hardware
qualification remains unverified; this lane made no paid calls or speech edits.

## 6. PR #93 review fixes

- [x] 6.1 Complete the single PR #93 review round. Bind files to window-owned pinned conversations, select media models, share readiness, retain keyless options, isolate Qwen endpoints, clear incompatible controls, preserve media deadlines and align UTF-8 file bounds. The tool-call report does not reproduce with pinned ai@7.0.153; preserve bounded terminal rejection and add multi-step/truncation fixtures. Also preserve legacy Moonshot models, normalize optional bot IDs, restrict OpenAI search, identify media capability errors and guard provider aliases. Lead superseded the initial two-finding deferral to open-quake-lih.15.6. Merge current main, regress valid findings before fixing, commit/push/reply separately, run full gates and reconcile unanswered threads. Bead: open-quake-lih.15.5.

Review round completed on the current-main merge d38cf245 and functional head
86bb5240. Thirteen bugs have failing-before regressions. The tool-call finding
was disproven against the pinned SDK, with bounded multi-step/truncation coverage.
All findings received attributed replies; the final GraphQL query had no unanswered
threads. No threads were resolved and the PR was not merged by this lane.

Final integrated gates: root Turbo tests passed with 3,439 tests and four skipped
(desktop 2,056, device 509, edge 811, protocol 63 cached). Six typecheck tasks,
the desktop build, both bundle modes, lint of 1,272 files with zero errors and
14 existing warnings, and all 47 strict OpenSpec validations passed. Both hidden
native media and production direct-chat smoke checks passed using mock hardware
and fake providers. Earlier pre-integration runs had load-related timeouts; the
final required two-worker command passed. Hosted checks remain owned by the lead.
Live providers and hardware remain unverified; this round made no paid calls.

## 7. Assistant-config burn-down lane

- [x] 7.1 Implement typed key controls and fake consumer execution for AI-003/009/041/042/053/054/055/056/057/058/059/060 and MGMT-285. Bead: open-quake-lih.15.7.
- [x] 7.2 Implement named model controls, General provider choice and subsequent-turn synchronization for AI-019/043/062 and SETTINGS-008/102. Bead: open-quake-lih.15.8.
- [x] 7.3 Implement explicit knob migration, assignment/preview and agent/model retention for AI-065, KNOB-034 and MGMT-212/308. Owning knob-configuration spec updated. Bead: open-quake-lih.15.9.


The assistant-config lane implements the 22 assigned software handoffs with
portable key controls, a named Models editor, General provider selection and an
explicit reviewed knob replacement. Mounted Save/reopen tests and fake-provider
consumer tests cover persistence, sampling, search/thinking, context expiration,
history and the assistant/global HA allowlist intersection. Imported role/control
actions remain readable until the first typed save. Models and Speech links use
in-document navigation so management write authorization remains valid.

Software coverage does not qualify physical device display/animation, microphone,
live provider credentials, speech playback or real HA. Auto device targets other
than allowed HA remain unavailable in the desktop binding; the editor says so.
DK Claw knob assignments persist but capture remains unavailable in its owning
route. The three task beads stay open for lead review and merge.

## 8. Final PR #114 review round

- [x] 8.1 Propagate production HA runtime cancellation and recheck turn identity after the HA semaphore/allowlist wait. Reproduce cancelled and superseded turns against fake equipment before fixing. Bead: open-quake-lih.15.11.
- [ ] 8.2 Reconcile followed General Settings provider controls in execution and the assistant editor, with failing-before fake-provider and mounted UI regressions. Bead: open-quake-lih.15.11.
- [ ] 8.3 Reproduce and fix the hosted assistant-wake lifecycle test against the renderer-ready activation queue; complete the requested gates and final unanswered-thread follow-up handoff. Bead: open-quake-lih.15.11.
