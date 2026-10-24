# PR33 review round two: base modules

The twelve assigned findings are valid and fixed in source commit
`17dfe7b254791ed5d7433c931bf4495a2d1bab1c`. This source includes main
`85f1e3bacc49e16f2965f614a5ce2a38f6eb3e06` and starts from PR33 head
`7d039d45fb22f9f43c970efdde23098afc6321ab`. Implementation and verification
are by Codex (gpt-6.1-sol). Only base PR33 is changed. Parent owns independent
verification, final-head review, integration into PR34 and ordered merges.

OpenSpec task 7.10 was added and strictly validated before implementation.
Bead `open-quake-lih.17.1.34` and task 7.10 close with this report. Other
tasks retain their existing state, including prior-worker task 7.9 and
top-worker task 7.11. Physical, packaged-app and real native-paste acceptance
remain outside this completion.

Evidence references below are relative to the owned
`management-center/review-round-2/` artifact root unless stated otherwise.
`PROMPT.md`, `REQUEST.md` and `findings-before.json` preserve the request and
the twelve exact unresolved review comments. No reviewer was requested,
triggered or polled.

## Findings and consumer proof

| Review thread | Correction and regression |
| --- | --- |
| `PRRT_kwDOUADXpM6v6Vl8` | Credential availability caches booleans, shares concurrent reads, expires after 30 seconds and holds at most 256 references. Store/remove invalidate entries; a late read cannot restore availability after removal. Actual conductor views with copied scope references read the vault once across repeated snapshots. TestClock expiry, external removal and in-flight removal are covered. Baseline made 21 reads where the regression permits one (`logs/availability-red.log`). |
| `PRRT_kwDOUADXpM6v6Vl_` | Agent storage fixtures use `realpath(tmpdir())`, preserving canonical-root checks. The portable fixture suite passes with TMPDIR unset (`logs/portable-os-temp-green.log`). |
| `PRRT_kwDOUADXpM6v6VmB` | TLS certificate material uses the canonical OS temporary directory. The real loopback TLS consent, changed-certificate and cross-origin tests pass in the same portable run. |
| `PRRT_kwDOUADXpM6v6VmC` | The REST decoder recursively flattens HA field sections to leaf names and preserves required/type/range/select metadata. Baseline yielded `advanced_fields` (`logs/grouped-red.log`). Tests cover decoded validation and real loopback REST service_data. Mounted native controls save through production IPC and execute flat brightness/transition/effect data. |
| `PRRT_kwDOUADXpM6v6VmF` | The integrations README uses a repository-relative research archive reference in place of the developer-local source path. |
| `PRRT_kwDOUADXpM6v6VmH` | Workspace Save walks every dirty file and advances the revision from each successful reply. Partial failure keeps the dialog and remaining drafts; retry skips already saved files. A production authorized-controller/storage regression injects the second-write failure and reloads all three successful edits after retry. Mounted multi-tab edit/Save/reopen proof reproduced baseline loss (`logs/native-workspace-red-3.log`) and passes on the fixed source. |
| `PRRT_kwDOUADXpM6v6VmI` | Skill folder generation always begins with a letter, falls back for non-ASCII names and allocates collision suffixes. Original display names remain intact; race conflicts show the existing specific conflict message. Production service regressions and mounted creation cover `3D tools`, non-ASCII names and collisions. Baseline numeric creation kept the dialog open (`logs/native-skill-red.log`); fixed creation persists. |
| `PRRT_kwDOUADXpM6v6VmM` | The default shortcut title uses canonical weighted-name truncation; application identity remains the full original label. Baseline produced `Adobe Photoshop Shortcut Pack` (`logs/native-shortcut-red.log`). The fixed mounted consumer saves the library, syncs it through production profile placement and reloads it with the bounded title. The canonical limit remains unchanged. |
| `PRRT_kwDOUADXpM6v6VmN` | Successful durable model transactions compare references across all remaining scopes before retiring secrets. Rotation, row/agent deletion and both inheritance transitions preserve shared live references. Failed persistence preserves old credentials and rolls back newly stored secrets. Cleanup failure reports scrubbed stable diagnostics and retains pending references for retry on a later successful transaction. Regression covers cleanup failure plus retry without deleting shared references; baseline failures are in `logs/models-red.log`. |
| `PRRT_kwDOUADXpM6v6VmQ` | Both default-scope inheritance commands fail at the service boundary, preserving the global catalog and revision. Actual command regressions exercise both directions. |
| `PRRT_kwDOUADXpM6v6VmT` | Model validation rejects literal and encoded brace placeholders before persistence or credential writes. Blank Azure defaults fail; an explicit real Azure URL succeeds through the service. |
| `PRRT_kwDOUADXpM6v6VmW` | Execution checks actionable entity/service/data without checking ephemeral display attributes. Save still validates display details, and AI execution still requires the entity allowlist. Baseline rejected the action with Display Info after polling (`logs/ha-red-corrected.log`). Direct and allowed AI consumers now execute after an attribute disappears; revoked AI access still fails. Native production IPC proof covers the same state transition. |

## Six fresh gates

All gates passed on the exact source tree committed as `17dfe7b`. Receipts
are `gates.json`, `source-receipt.json` and `logs/gate-{1..6}.log`.

1. `pnpm biome check packages apps`
2. `pnpm exec turbo run typecheck --force --concurrency=1 --env-mode=loose`
3. `pnpm exec turbo run test --force --concurrency=1 --env-mode=loose -- --maxWorkers=2 --no-cache`
4. `pnpm exec turbo run build --force --concurrency=1 --env-mode=loose`
5. `pnpm --filter @open-quake/desktop test:bundle`
6. `openspec validate --all --strict`

Tests: **1,535 across 166 files**: desktop 863/106, edge 222/22, device
390/34, protocol 60/4. Strict OpenSpec validation passed **39 items**. Both
default-HID typed-absence and explicit-mock bundle modes passed. All Turbo
runs used the explicit loose environment above. Mock device mode was set,
ELECTRON_RUN_AS_NODE was unset, and TMPDIR and smoke scratch were existing
absolute owned ExtSSD directories. Maintenance environment protections
were retained; restricted maintenance source was not read or changed.

## Real Electron consumers

After the production build, review, combined media, voice and weather
smokes ran sequentially on exact source `17dfe7b`. Each passed with exit 0
and its required marker. `native.json` preserves the receipts; individual
build/run logs are `logs/native-final-{review,media,voice,weather}*.log`.

- Review: `PR33 native mock production IPC, ownership, allowlist, persisted secrets, UI and disposal passed`
- Combined media: `W6 Electron smoke PASS:`; zero missing-owner warnings.
- Voice: `Voice smoke PASS:`
- Weather: `weather/media native mock smoke PASS;`

The review harness's original scratch-root assertion remains unchanged.
Its owned raw proof is under
`management-center/review-round-1/base-round-2/final-17dfe7b2/proof.json`.
Every proof flag is true, including multi-tab persistence, valid skill
folders, grouped HA fields saved/executed, action after disappearing
display attributes, default shortcut saved/synced, prior ownership,
allowlists, model/slot draft retention and awaitable shutdown.

All **15** final review captures were viewed and their SHA-256 hashes match
proof.json. Changed controls fit the captured viewport, with explicit
saved-state waits and larger skill/shortcut viewports:

- `round-two-workspace-dirty-tabs.png`
- `round-two-workspace-reloaded-identity.png`
- `round-two-workspace-reloaded-soul.png`
- `round-two-workspace-reloaded-agents.png`
- `round-two-workspace-reloaded.png`
- `round-two-skill-folders.png`
- `round-two-default-shortcut-synced.png`
- `base-channels.png`
- `base-ha-optional-cleared.png`
- `base-ha-revoked.png`
- `base-shortcuts-existing.png`
- `base-agents.png`
- `base-model-drafts-retained.png`
- `base-agent-model-drafts-retained.png`
- `base-slot-drafts-retained.png`

## Retained failures, retries and limits

Every development/red/green attempt remains in `logs/`. The first targeted
pnpm test invocation accidentally selected whole package suites; the
corrected invocation used `exec vitest run`. Initial HA fixtures used the
wrong command name and an entity absent from the allowlist; these were
corrected to the production `ha.key` command and existing `button.reset`.
Compiler failures exposed recursive optional typing, a missing import,
callback error-channel typing and a missing test runtime layer. All were
corrected before the six final gates, without casts or weakened guards.

Native development retries corrected the Edit-button selector, implicit
dialog selector, chord focus/blur, target shape, and same-page refresh by
unmounting/remounting the actual consumer. The initial skill capture clipped
the final row; the final larger viewport capture was inspected. These
instrumentation failures are separate from the retained baseline feature
failures listed in the table. Chromium Shared Dictionary/cache warnings
remain visible in logs; no warning suppression was added.

Availability can reflect an external keychain change for up to 30 seconds.
Failed credential-cleanup retries are session-local; the stable scrubbed
warning makes failure visible but is not a durable cleanup queue. Renderer
replies remain write-only for secrets. Agent runtime and AI adapters remain
explicitly unavailable in production. Native proof mounts production UI
and uses production IPC/services with synthetic IO; it does not establish
real provider, real HA server, hardware, packaged-app or real clipboard/paste
acceptance. Parent retains those acceptance and final-review decisions.
