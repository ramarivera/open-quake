# Agent workbench

Implements management-center-parity tasks 4.1–4.5. All filesystem, profile,
credential and provider operations stay in main. The renderer receives a
Schema-validated bridge with write-only credential status.

## Application composition

```ts
import { registerAgents } from "./agents";

const agents = registerAgents({
  management: () => managementWin,
  renderer: rendererURL,
  profiles: profiles.runtime,
  credentials: managementAgentCredentials(credentialRoot),
});
// Before disposing profiles:
await agents.dispose();
```

The optional `backend: AgentRuntimeAdapter` and `drafting: AgentDraftAdapter`
are explicit host capabilities. Without a backend, lifecycle controls are
unavailable and no installer or mock backend runs. Without drafting, generation
returns `AGENT.DRAFT.UNAVAILABLE` and leaves workspace files unchanged.
`agentDraftsFromProvider(provider, models)` adapts the existing
`AiProviderService`; `models.request(agentId, prompt)` supplies a validated
inference request resolved by the host. `agentCredentialsFromVault(vault)` can
adapt the existing `CredentialVault` instead of the parent's credential adapter.
Neither adapter returns stored secrets to the renderer.

In the profiles composition, merge `agentProfileFunctionContracts` from
`./agents/profile-contracts` into the canonical validator map. Supply the
resulting `profileFunctionContractsLayer` alongside storage to
`ProfileRepository.DefaultWithoutDependencies`. An agents-only composition can
use `AgentProfileContractsLive`. `ProfileRepository.Default` supplies its own
empty validator map and rejects edits to built-in DK-Claw keys. All profile
services must share the same repository instance.
`profile-binding.test.ts` exercises the canonical
`ManagementProfileContractsLive` composition through the agents service and
existing profile manager consumer. Its regression case proves that retaining
`ProfileRepository.Default` rejects sync despite supplying the canonical layer,
without changing profiles or assignments.

Preload entry imports `../main/agents/preload`. It exposes `window.quakeAgents`
with `request`, `onSnapshot`, and `onProgress`; both subscriptions return
cleanup functions. No IPC registration happens from importing the main module.

Renderer:

```tsx
import { AgentsPage } from "./management/agents";

<AgentsPage initialTab="sessions">
  <ChannelsPage />
</AgentsPage>
```

`initialTab` accepts `sessions | agents | ai | settings` and responds to changed
props for deep links. Children render inside Settings below DK-Claw. An optional
`bridge` prop supports an isolated renderer harness. `RuntimeIndicator` is also
exported. Tabs retain mounted state while hidden; dialogs use the native modal
focus and Escape behavior.

## Persistence and failures

`<userData>/agents-v1/current` points to one immutable generation containing
`state.json`, `workspaces/<agent>/*.md`, shared `skills/<folder>/SKILL.md`, and
per-agent `workspaces/<agent>/skills/<folder>/SKILL.md`. Files are mode 0600,
directories 0700. A staged generation and pointer publish atomically. Failed
staging removes the draft and preserves the previous pointer and files. Committed
obsolete generations are removed, including deleted agents' old workspaces;
`cleanupFailures` records collection failures separately from commit failures.

One repository semaphore serializes reads and commits. Workspace, skill and
model saves check the displayed revision. Skill moves distinguish conflict,
invalid workspace, moved source and incomplete commit by stable error codes.
`main` is seeded and protected at the service boundary, independent of UI.

DK-Claw uses profile `1-8`, keys `1,5`, `1,6`, `2,5`, `2,6`. The profile binding
preflights its first page, saves through revision-checked `ProfileService`, then
calls the existing manager selection/delivery consumer only when a connected
session has DK-Claw active. Other panels are deferred. Failure after save
restores the previous content with the saved revision as the expectation;
restoration advances the profile revision and never rewinds it. Assignment
state commits only after the profile/device steps succeed. A failed restore
returns `AGENT.PANEL.ROLLBACK_FAILED`. Progress events are separate from snapshot
reads so the repository lock cannot hide live stages.

Runtime operations are Effects owned by `AgentsRuntime`. Start/restart time out
at 10 s; stop at 5 s. Interruption cancels the adapter. State changes are subscribed,
without a renderer polling loop. A runtime adapter resolves an operation only
when the requested backend state is reached.

## Source mapping

Research root is local-only:
`/Users/ramarivera/dev/dark-encyclopedia/dk-suite-introspeccion/v0.4.95/`.
The implementation read `audit/AUDIT_CENTER.md` and the actual sources below.

- CENTER-019–022, 024, 026, 028: recovered
  `src/views/ManagementCenter/ClawControlPanel.vue:1`,
  `components/OpenClawRuntimeIndicator.vue:30`,
  `components/ClawSessions.vue:68` and
  `services/openclaw-bootstrap-state.js:143`. Runtime error reachability,
  subscription and bounded cancellation follow the open-quake spec.
- CENTER-049–055, 057–060: recovered
  `components/agents/ClawAgentManagement.vue:77`, `:254`, `:506`,
  `components/ClawSettings.vue:1006`, `:1308`, and `src/utils/agentKey.js:1`.
  Workspace templates are authored here; no vendor persona files are copied.
- CENTER-065–068, 070: recovered `components/ClawAIConfig.vue:754`,
  `utils/ai-config-utils.js:8`, `utils/ai-provider-defaults.js:5`.
  Provider URLs/common-model facts live in the edge provider-defaults module.
- CENTER-045, 046, 103: recovered
  `components/DkClawEditionInstallSection.vue:135`,
  `app-resources/background.js` byte 1964045 for sync/rollback and byte 3710196
  for slot patching. Local agent choices replace vendor scene editions.
- UI strings: `locales/locale-en.json`, relevant `clawControlPanel`,
  `openclawRuntimeIndicator`, `clawSessions`, `clawAgentManagement`, `clawAIConfig`
  and `clawSettings` entries, copied verbatim into renderer `strings.json`.

Suggested planning corrections, for the parent to synchronize: the locale's
literal labels are `Create agent`, `Basic Info`, `Role Config`, `Save Agent`,
`Default Config`, `Agents Config`, `Apply scope`, and credential absence
`Not configured`. The current spec paraphrases/capitalizes several differently.
No OpenSpec artifact was edited by this implementer.

## Consumer verification

```sh
pnpm --filter @open-quake/edge exec vitest run src/agents
pnpm --filter @open-quake/desktop exec vitest run src/main/agents
pnpm typecheck
pnpm exec biome check packages/edge/src/agents apps/desktop/src/main/agents \
  apps/desktop/src/shared/agents.ts apps/desktop/src/renderer/src/management/agents
```

Tests use the production service, IPC handler and preload, actual temporary
workspace files, the native vault service over a fake keychain, the existing AI
provider facade over a fake compatible adapter, and real profile services plus
manager/controller over fake storage/delivery ports. Effect TestClock checks
both sides of each runtime timeout. Latest focused run: 14 edge tests and 16
desktop tests passed; repository-wide `pnpm typecheck` and owned-file Biome
passed. The parent owns native renderer screenshots
and repository-wide delivery gates. This lane does not access hardware, start
DK-Suite, commit, or create a PR.
