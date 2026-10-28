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
- [x] 8.2 Reconcile followed General Settings provider controls in execution and the assistant editor, with failing-before fake-provider and mounted UI regressions. Bead: open-quake-lih.15.11.
- [x] 8.3 Reproduce and fix the hosted assistant-wake lifecycle test against the renderer-ready activation queue; complete the requested gates and final unanswered-thread follow-up handoff. Bead: open-quake-lih.15.11.
- [ ] 8.4 Follow up on current-default knob capture pinning, configured-row provider selection, and preserving HA dispatch outcomes in assistant responses. The final review round tracks these separately in bead open-quake-lih.15.12.

## 9. Assistant-routing burn-down

- [x] 9.1 Complete key/persona execution and title migration. Bead open-quake-lih.15.13.
- [x] 9.2 Complete legacy prompt catalog and desktop persona updates. Bead open-quake-lih.15.14.


Assistant-routing software evidence: `chat/transport.test.ts` drives per-key
sessions, wake dictation, six Copilot roles and subsequent-turn persona Update
through real RPC and loopback providers. `AssistantEditor.test.tsx` covers
review/save/reopen, role controls and sampling; `useAssistantSelection.test.tsx`
covers transcript acknowledgement races. Device profile tests cover idempotent
title repair; edge catalog tests cover retained locales, exclusions and fallback.

Final lane gates passed 4,983 root tests with four skips, six typecheck tasks,
the desktop build and both bundle modes. Hidden, muted native mock smoke passed
real persona RPC and Update with EN/DE screenshots in lane SSD scratch. Strict
OpenSpec 1.15.0 remains 9 pass / 38 fail from inherited requirement-length
warnings, tracked in open-quake-lih.23.2. None of the new lane requirements are
flagged. Linux execution, physical QUAKE, microphone, playback, real HA and paid
providers remain unverified. Beads .15.13 and .15.14 stay open for lead review
and merge; task 8.4 and physical/live acceptance remain open.


## PR128 batched review fixes

- [x] Reconcile selected-session ownership, draft identity, model admission, capture cleanup and HA assignment validation with real-consumer regressions. Bead open-quake-lih.15.16. Implementation beads .15.13/.15.14/.15.15 remain open for parent review.


PR128 fix1 implements all nine distinct findings from eleven threads. Direct
knob session identity now includes its pinned profile; explicit persona rows use
the editor catalog; capture resolves empty overrides and reconciles followed
provider models before pinning. Mounted persona drafts refresh on selection
generation, discard late reads/Update results, and send a generation-bound
Update. Selected edits never write the global persona. They remain in memory
until key reselection or session eviction; saved key settings remain the
reselection/restart source. Assistant RPCs claim unowned selected sessions and
reject foreign read/update/selection/ack operations using existing ownership.
Gateway refusal terminates the original reservation before localized busy
feedback. Canonical HaKey validation is shared below edge; invalid imports stay
inert, Save rejects malformed actions, and valid configData remains verbatim.

Focused production-consumer regressions cover loopback inference/history,
selected/global persona isolation, two real encoded RPC connections, mounted
async destination races, refused capture followed by a grid capture, imported HA
presses and profile Save rejection. Fail-before logs reproduce the original
routing, isolation, ownership, capture and malformed-assignment defects. Tests
use fake microphone permission/providers/equipment only. Six package typechecks,
Biome, desktop build, both bundle modes and hidden muted native persona smoke
passed; four EN/DE captures were visually inspected. Strict OpenSpec 1.15.0
retains the inherited 9 pass / 38 fail requirement-length baseline in
open-quake-lih.23.2. None of this round's new requirements are flagged.

Bead open-quake-lih.15.16 remains in progress for parent diff/reply review.
Implementation beads .15.13/.15.14/.15.15 stay open. No review threads were
posted to, resolved or retriggered by this lane. Hardware, real microphone,
playback, real HA, live providers and Linux remain unverified.


## PR128 final review fixes

- [x] Share canonical selection/submission routes and prove select, typed turn, dictation and reselection preserve one history while direct model revisions stay isolated. Bead open-quake-lih.15.17.
- [x] Synchronize New chat and history navigation with the host persona destination, retain session-local settings on reopening, and reject stale or foreign navigation. Use an additive desktop RPC only because close cancels a session and cannot select a destination. Prove mounted UI/controller/encoded bridge/host behavior, then run focused tests, typecheck, lint and build and push once. Parent owns review replies and gates. Bead open-quake-lih.15.17.


PR128 fix2 shares the five-field session route for key selection and submission.
The loopback regression drives key select, typed turn, dictation and reselection
through one session and verifies outbound prior user messages. Existing direct
profile A/A/B coverage still proves same-model reuse and changed-model isolation.

Desktop navigation uses the additive `assistant.navigate` RPC with the observed
selection generation. Both source and destination retain window-owner checks;
stale navigation cannot replace a newer key selection. New chat and ordinary
history clear the device destination; reopening a cached key session restores
its local settings without rewriting the global persona. Key-origin selection
consumption skips desktop navigation, and renderer epochs discard late reads.

Mounted New chat and history buttons drive the actual controller, encoded
preload bridge and host. Persona reads, Update and later fake-provider requests
use the opened destination. Coverage also proves same-session local edits,
reopened-key continuity, stale draft rejection and foreign-window refusal.
Three behavioral regressions fail against a790d481. Final focused coverage
passes 125 tests in eight files; six package typecheck tasks, Biome with zero
errors plus 16 existing warnings and two infos, desktop build and both bundle
modes pass. Strict OpenSpec 1.15.0 repeats 9 pass / 38 fail under the inherited
requirement-length baseline open-quake-lih.23.2; this round's requirement isn't
flagged. Hidden, muted native persona smoke also passes with four EN/DE captures;
the Update captures were visually inspected. Those screenshots show the
persona controls, while mounted UI regressions prove navigation. Full root
tests weren't rerun. Initial fixture errors, corrected in the
final tests, and the interrupted overbroad test invocation remain in scratch.

Bead open-quake-lih.15.17 stays in progress for parent acceptance. This lane
doesn't reply, resolve, retrigger review, watch or merge. Real device input,
microphone, audio playback, providers and Linux remain unverified.


## PR128 destination and composer residuals

- [x] Make aiChat capture preparation follow its actual direct or external destination while retaining voice/speech admission, capture cancellation and connection generations. Regress the production composition with fakes. Bead open-quake-lih.15.18.
- [x] Derive mounted composer readiness from its current global or selected-session persona and catalog, retaining navigation epochs and stale-response guards. Cover persona updates and key/history navigation. Bead open-quake-lih.15.18.
- [ ] Push one tested batch and hand current-head CI/review acceptance to the parent. Keep the bead open until remote gates are accepted. Bead open-quake-lih.15.18.


PR128 continuation implements both source-confirmed residuals on
open-quake-lih.15.18. The capture owner reads enabled key voice settings, then
pins either the connected HTTP selection and registry generation or the local
model. External capture no longer acquires unrelated local credentials.
Finalized transcripts revalidate external ownership under the adapter lock;
prepared direct captures retain their local destination. Early release interrupts
preparation and frees the reservation before another capture.

AgentsPage passes the current model catalog through Workspace to the mounted
composer. Its effective model follows the host-owned global or session persona,
including explicit default-catalog rows, and retains credential gating. Reads
check navigation epoch, session identity, selection generation and catalog
identity. Polling observes subsequent persona Update without changing the global
model. The composer displays the effective provider/model and refuses missing or
failed configuration.

Focused verification passes 82 tests in nine files, plus 13 targeted transport
regressions for prior history/direct-route distinctions, persona/RPC ownership
and dictation. The three changed ownership/composition files also pass 31 tests
after final lock/generation hardening. Six package typecheck tasks pass, with
unchanged packages cached; desktop types rerun after the final test fixture fix.
Desktop build and both headless bundle modes pass. Biome has zero errors and the
existing 16 warnings/two infos. Both owning OpenSpec changes validate with their
inherited requirement-length warnings, tracked by open-quake-lih.23.2; the new
requirements do not add warnings. The full root suite and native UI were not run.
All providers, capture, playback, HTTP health and equipment in these checks use
fakes. Real device/HID/input/microphone/audio/provider/Linux acceptance remains
unverified.

The bead remains in progress for parent acceptance of the pushed SHA and remote
CI/review. This is one authorized batched continuation; this lane does not reply,
resolve, retrigger reviews, watch or merge. Evidence is retained under
/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/burndown/assistant-routing/continuation/.

## Speech settings form recovery, open-quake-l86.31

- [x] Validate provider drafts and credential reuse scope before enabling Save, retain main validation and add visible missing-input feedback.
- [ ] Verify the mounted form against invalid/valid drafts, partial XFY secrets and credential scope changes; run focused types/lint and deliver.

Speech form evidence: all four mounted regressions fail against the unchanged pre-fix component because Save remains enabled. The corrected form plus existing main settings and IPC tests pass 11 checks. Desktop typecheck and root lint pass, retaining the existing 20 warnings and 3 informational diagnostics. No provider execution, real credentials, microphone capture or native input occurred. The broad native sweep is not repeated for this bounded form correction.

- [x] Localization correction: use English prompt catalog fallback outside Chinese locales and verify regional locale normalization. Bead `open-quake-l86.36`, implementation tracked in `agent-naming/tasks.md` section 2.
