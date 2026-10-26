# Agent HTTP runtime verification

All ten owned lanes are integrated on feat/agent-http-runtimes, stacked on the desktop release branch. Shared contracts, both provider adapters, bounded fetch/SSE transport, encrypted connection storage, registry/discovery, cancellable conversations, management UI and main/preload composition are present. No new runtime dependency was added. Edge fixture tests use the existing catalog @types/node version.

Parent checks passed 172 edge runtime tests before the five final cross-provider acceptance tests, 118 desktop service/voice/root tests and 49 management UI tests. Both package typechecks and focused Biome passed. The production desktop build passed. The bundle smoke initially tolerated HTTP setup failing because its macOS temporary-directory alias failed the storage realpath guard. Requiring both new IPC request owners reproduced that failure. Canonicalizing the test directory preserves the production symlink guard and both startup/quit assertions now pass in default-HID and mock modes without hardware I/O.

The actual installed Hermes 0.21.3 API and actual open-quake Hermes adapter/fetch transport completed one isolated zero-tool live conversation through the authorized HTTPS inference gateway using exact gpt-6.1-sol. The response included expected text, reported usage, one completion and a real session ID. The loopback-only temporary process stopped and its listener disappeared. Saved Hermes configuration, authentication and service files were unchanged. No Claude model was used. The local CLI OAuth refresh failure is independent of this successful route and does not establish a desktop login problem.

Live OpenClaw, desktop connection/chat interaction with a live backend, live continuation, tool execution and hardware acceptance remain unverified. The existing desktop microphone/STT/TTS and audible playback gap remains open in open-quake-lih.15.1.15 and voice-stt-tts tasks c5w.6/c5w.7. Production text and the transcript helper are covered. The helper has no production capture caller; speech acceptance is not claimed. PR bot review and hosted CI for the functional changes are reconciled below. No merge, version tag, public release or saved runtime reconfiguration is part of this delivery.

## Initial hosted validation and review

Codex completed review of f2827d0 with no findings and no open threads. CodeRabbit skipped the stacked base, which does not count as a review. Run 40194487144 passed lint, release tests, typechecks and all 410 edge tests. Desktop tests found three failures in two new fixtures because they hardcoded this Mac's external-volume scratch path. Those fixtures now create unique directories under Node's portable temporary directory and canonicalize the parent path, matching existing storage tests. Permission, corrupt-record, symlink, credential and HTTP consumer assertions remain intact. Hosted Linux confirmation is pending.

Devin subsequently supplied three findings. The permanent request-ID exhaustion and unusable Hermes model aliases are accepted. Replay protection now retains active/history identities plus a bounded recent window while reclaiming old tombstones. A regression reproduced the 4096-start failure before correction and verifies new work after history clear while active/retained/recent duplicates remain rejected. Model-route selection reaches the provider through the existing start modelId, history exposes the optional route, and switching routes creates a fresh conversation scope. UI/controller/IPC/service checks cover forwarding and rejection of cross-model remote-session reuse. The transcript-caller finding is valid and remains deferred to the existing speech acceptance tasks; documentation and PR wording now explicitly distinguish production text from the unbound transcript helper.

The round-one fix batch passed 179 edge HTTP-runtime tests and 148 desktop service/root/UI tests, both package typechecks, production build and both bundle startup modes. The 28 filesystem/voice-adapter tests also passed with an explicitly supplied canonical scratch temporary directory. Production storage guards and installer assertions are unchanged. Hosted rerun and review of the functional fixes remain pending.

## Final functional verification

Run 40195569171 on ec948aeffe8bfde0d12e61fd626b11604221ae60 passed validation, all five native package/install jobs and the complete eight-download matrix check. This confirms the portable filesystem fixtures on hosted Linux and the integrated runtime build across Apple Silicon, Windows x64/ARM64 and Linux x64/ARM64. Publication correctly skipped on the PR event.

Codex completed review of that exact functional head with no findings. All three Devin threads have attributed replies and are resolved: request-ID exhaustion and model selection were fixed, and the missing production speech caller was explicitly deferred to the existing speech tasks. CodeRabbit's stacked-branch skip is not counted as a review. The requested review round is reconciled; the live acceptance limits above remain unchanged.

The final delivery update changes only this evidence record and the task checkbox. Fresh checks for that documentation-only update remain under T3 monitoring until settled. No additional functional review round, merge or release is claimed.

## Disposable container acceptance extension

Ramiro authorized disposable Compose inference testing and merging the reviewed stack. PR38, PR39 and PR40 are now squash-merged into main. The PR40 conflict resolution preserved runtime registration and Node declarations, passed 31 lifecycle tests, and cleared exact-head Codex review and the complete hosted installer matrix before merging. No release tag was pushed.

The opt-in runner pins OpenClaw 2026.10.7 by immutable image digest and Hermes source e10934b03e115b036b3c38b9c6e6817039a5962d with its frozen dependency lock. It takes provider base URL, optional API key and model exclusively from environment variables, publishes random loopback-only API ports, generates a fresh runtime bearer and stores runtime state in container tmpfs. Toolsets/plugins are disabled, runtime dependency installation is disabled, and no user configuration or home is mounted. Hermes uses its advertised endpoint alias rather than confusing it with the backend model ID.

An actual run passed all three live cases: Hermes chat, OpenClaw Responses and OpenClaw chat completions. Each verified unauthorized discovery rejection, authenticated health/capabilities, a real streamed marker response, exactly one completion, and a second turn recalling the first marker through the returned session ID. All six successful conversation requests used the exact authorized gpt-6.1-sol route, with no Claude or tool events. Hermes additionally reported zero enabled toolsets. Compose teardown confirmed no owned containers or network survived; the temporary source checkout was removed. Docker image/build caches intentionally remain. The passing run took 29.69 seconds inside Vitest, excluding image preparation.

The two offline configuration tests pass, edge typechecking passes, and all 412 edge tests pass while the three live cases skip without the opt-in flag. The first image attempts exposed upstream editable-install requirements, inaccessible managed Python under root's home, and the API server's aiohttp extra. The final image uses the upstream supported editable install, its public bundled interpreter and frozen messaging dependencies without configuring messaging platforms. A deliberate post-readiness failure exited unsuccessfully before inference and still verified Compose teardown. A separate SIGTERM during readiness aborted active operations, made no inference calls and also verified teardown. The new test PR's review/checks remain pending.

Read-only speech inspection confirms the default USB PnP microphone is enumerated as mono 48 kHz, which does not establish permission or signal quality. Production capture still fails unavailable, the normalized transcript helper has no microphone caller, and authenticated WebSocket, audio-output ownership and answer speech integration are absent. Existing speech tasks remain open. The documented physical acceptance sequence waits for those bindings and supported speech profiles; no microphone recording, audio playback or foreground input was performed for this extension.

## Container review fixes

Devin's round-one review identified failed-teardown recovery, host-loopback provider reachability, diagnostic credential retention and missing volume verification. The runner now preserves recovery state after failed teardown or inventory checks and reports its project name. A generated recovery Compose file contains no provider settings or bearer and needs no original source checkout. Cleanup verifies all project-labeled containers, networks and volumes before removing source state or reporting success. A real two-container recovery probe verified that this file removes both containers and their network independently of the original configuration.

Provider loopback addresses are rejected before Docker starts, with explicit guidance to use an address reachable from containers. Arbitrary subprocess output and runtime logs are neither saved nor printed; failure diagnostics contain only command, numeric exit code and signal. This avoids relying on literal secret replacement when provider errors encode credentials. Nine offline configuration/lifecycle tests pass, including failed down, failed enumeration, residual containers/networks/volumes and encoded-secret payloads. A fresh forced post-readiness failure verified real teardown with no inference requests. Edge typechecking, focused Biome and strict OpenSpec validation pass. Hosted checks and review of these fixes remain pending.

CodeRabbit correctly notes that OpenClaw's HTTP protocols don't expose internal tool events. The bootstrap now asserts its generated deny-all tool configuration before starting the runtime; zero observed tool events alone don't establish that invariant.

The review also correctly notes that live adapter tests don't establish the desktop selected-connection/IPC/conversation/UI path. That separate live acceptance is tracked as open-quake-hwn.12; the E2E README already states this limit. AirPods Max are Bluetooth-connected but not currently enumerated as a CoreAudio input. USB input identity and physical signal remain unverified. No audio device selection or recording was performed.

## Merged container delivery

PR41 was squash-merged as 78007a7040994a4eb625a364631b0a937b94e76d after run 40200809998 passed validation, all five native packaging/install jobs and the complete download matrix. Codex completed review of the final functional head 7d8d7e9bb6306eb71005c56243eb80f15ea56a74 with no findings. All six review threads have attributed replies and are resolved, including the separate live desktop coverage task. No disposable E2E containers, networks or volumes remain. The source checkout was removed after verified teardown; Docker image/build caches intentionally remain.

The original PR38/39/40 stack and the container extension are now merged. No release tag was pushed. Runtime HTTP inference and continuity are verified; desktop live routing and physical speech remain outside that evidence. Existing speech tasks and open-quake-hwn.12 remain open. This final documentation update synchronizes task 5.4 with the completed delivery and doesn't change functional code.

## Saved production profile acceptance, 2026-10-26

This section supersedes the historical generic provider environment configuration
and desktop coverage gaps above. The runner now requires an explicit saved model
row, scope, source app data directory and authorized model. A windowless native
Electron reader uses the production agent storage, model conversion, credentials
service and encrypted vault. Both containers receive only one temporary,
read-only provider snapshot. They never mount the source settings or vault.
Legacy provider URL/key/model environment inputs fail before native startup.

The normal application had no saved model, so acceptance used an isolated profile
saved through the actual AgentsService and native vault, with the explicitly
authorized gpt-6.1-sol route. No normal user settings were changed. One successful
run passed all three adapter cases against pinned Hermes and OpenClaw, then the
actual production root, preload, connection controls and conversation renderer
completed two turns per runtime. This establishes streamed completion, selected
connection/model identity, remote session continuity, local history and awaited
production shutdown. Tools remained disabled. Ten successful inference requests
used gpt-6.1-sol; no Claude requests were made.

All four native captures were inspected at actual content sizes 1180x625 and
390x625. Both narrow captures show the latest answer and reachable composer.
Assertions require no horizontal overflow, a composer within the viewport and a
capture matching the native content dimensions. Every test window stays hidden,
nonfocusable and click-through. No physical device, microphone or audible output
was used.

Success removed the Compose project and private snapshot. A deliberate failure
after authenticated readiness, SIGTERM after snapshot creation and SIGTERM after
both containers started also removed
the snapshot and all owned containers, networks and volumes. Fingerprints of the
source model state and encrypted credential files, including modes and mtimes,
were unchanged across these probes. Cleanup unit tests also require snapshot
removal when Docker teardown, inventory or residual-resource checks fail.

Eight profile selection tests and eleven runner configuration/lifecycle tests
pass. The desktop suite passes 1626 tests with one existing native skip; the edge
runtime suite passes 179 tests with three opt-in live cases skipped in the offline
run. Both typechecks, production build, both bundle startup modes, scoped Biome
and strict OpenSpec validation pass. The first current live attempt stopped
before inference because an obsolete test still required the removed model
environment variable. Removing that obsolete read allowed the successful run;
its failed project and snapshot were also cleaned up.

External evidence is under
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-finish/runtime-profile/`:
`live-run-2.log`, the three `oq-e2e-efe617461278e785-*-acceptance.json`
checkpoints, `desktop-e2e-GwsCbT/`, `cleanup-probes.json` and
`interruption-ready.json`.
Review, hosted release checks and merge remain pending under task 6.2 and
`open-quake-hwn.12`. Physical speech acceptance remains separately open.


## Delivery reconciliation, 2026-10-26

PR43 merged as `578b4a8` with the save-and-select controller transaction.
Automatic discovery cannot enter between connection save and selection, and
selection failure retains the completed save without duplicating a connection.
The real workspace calls that transaction through useConnections. The focused
controller regression was rerun during reconciliation and passes. This closes
open-quake-hbe.8.

PR70 merged as `32ee8b7` after current-head review, resolved findings and the
complete native package/download matrix. Its saved-profile production-root
acceptance supersedes the historical environment-provider evidence above.
Both runtime routes assert the exact selected connection and remote continuity,
then clean up their owned containers, network, volumes and profile snapshot.
This closes duplicate acceptance tracker open-quake-hbe.4 alongside the already
closed open-quake-hwn.12. Physical microphone/hearing remains separate.
