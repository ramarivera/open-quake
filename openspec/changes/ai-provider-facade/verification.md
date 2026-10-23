# W7 implementation verification

Verified on 2026-10-23 in `lane/ai-provider-facade`, based on `f135eb9`.

## Delivered scope

- Task 1.1: all design recommendations were already labeled approved. Removed
  contradictory approval-pending prose in both provider/chat designs and
  recorded the approved scope versus unverified integrations.
- Task 1.2: provider/profile/capability/event Schemas, credential-free summaries,
  pure endpoint/redirect/sampling/modality validation, and browser exports.
- Task 1.4, mock portion: Config-selected Effect facade, volatile profile
  repository, deterministic Effect Clock stream, single consumption,
  cancellation/revocation, pinned selection, and a typed SDK adapter port.
- Task 1.5, host portion: typed Keychain backend, opaque credential references,
  redacted host values, revocation before deletion, catalog failures, private
  original causes, and bounded diagnostic projections. No plaintext fallback.
- `ai-chat-core` task 1.2: Schema contracts and pure turn/session reducers for
  identity isolation, sequence checks, suggestions, terminal suppression,
  duplicate/gap recovery, snapshots, and lifecycle transitions.

Tests drive the actual provider service and host credential service through
injected adapter/storage boundaries. No ChatService or settings consumer is
claimed. Tasks 1.4 and 1.5 remain unchecked until their complete integration
acceptance is run. The source READMEs describe composition and recovery.

Minimal manifest changes expose package subpaths, register the edge test
script, reuse existing catalog test dependencies, and declare the desktop's
workspace edge/Effect imports. No catalog version or SDK package was added.

## Commands and observed results

```text
pnpm install
exit 0; lockfile up to date; already up to date; prepare completed

pnpm run lint
exit 0; Checked 85 files. No fixes applied.

pnpm run typecheck
exit 0; 6 successful, 6 total; 4 cached
edge and desktop were checked in this worktree

pnpm run test
exit 0; 4 successful, 4 total; 2 cached
edge: 4 files, 23 tests passed in this worktree
desktop: 8 files, 93 tests passed in this worktree, including 6 new credential tests
protocol: 2 files, 25 tests passed from shared cache
device: 5 files, 36 tests passed from shared cache

pnpm run build
exit 0; 1 successful, 1 total; 0 cached
desktop main, preload, and renderer bundles produced

openspec validate ai-provider-facade --strict
exit 0; valid

openspec validate ai-chat-core --strict
exit 0; valid

git diff --check
exit 0; no whitespace errors
```

The first dependency resolution warned about existing peer-version mismatches:
electron-vite 5.0.0 declares Vite 5/6/7 while the repo uses Vite 8.2.2;
@effect/vitest 0.30.0 declares Vitest 3 while the repo uses Vitest 4.1.11.
The same catalog pairing is used by the protocol/device suites. The final
up-to-date install and all build/test gates passed.

Browser bundle verification used the installed desktop Vite with `write: false`:

```sh
pnpm --filter @open-quake/desktop exec node --input-type=module -e '
import { build } from "vite";
const entries = [
  "packages/edge/src/ai/ai-contracts.ts",
  "packages/edge/src/chat/chat-contracts.ts",
  "packages/edge/src/chat/chat-invariants.ts"
];
for (const entry of entries) {
  const result = await build({
    configFile: false, root: "../..", logLevel: "error",
    build: { write: false, lib: { entry, formats: ["es"], fileName: "contract" } }
  });
  for (const bundle of Array.isArray(result) ? result : [result]) {
    for (const chunk of bundle.output) {
      if (chunk.type !== "chunk") continue;
      const ids = Object.keys(chunk.modules);
      const forbidden = ids.filter(id => /node:|ai-service|ai-repository|ai-credentials|credentials\/keychain|adapters\//.test(id));
      if (forbidden.length) throw new Error(JSON.stringify(forbidden));
      process.stdout.write(entry + ": browser bundle passed, " + ids.length + " modules, no host/provider imports\n");
    }
  }
}'
```

Result: exit 0. Provider contracts bundled 120 modules, chat contracts 121,
and chat reducers 14, with no host/provider modules. An initial inspection
script assumed Vite returned one output object; it was corrected to handle
the library build's output array before the successful run.

## Needs approval

Exact SDK packages proposed for task 1.3, not installed:

- `ai@7.0.150`, requiring Node >=22.
- `@ai-sdk/openai-compatible@3.0.77`.

New direct declarations reuse existing catalog pins: desktop
`effect@3.22.1`; edge test dependencies `@effect/vitest@0.30.0`,
`vitest@4.1.11`, and `fast-check@4.9.0`. The desktop also declares the internal
`@open-quake/edge` workspace dependency.

## Unverified and remaining acceptance

No DK-Suite, hardware access, live provider call, credential, OAuth login,
Keychain prompt, or native helper was used. Tests generate disposable synthetic
credential values at runtime. Native Keychain binding and real settings/preload
wiring remain open. Local revocation survives the vault lifetime; durable
deletion after native failure requires recovery work at the host/settings layer.

SDK implementation and real ChatService integration remain open. Named spans
exist, but a distributed FE-to-BE-to-FE trace has not been exercised. Persistence,
RPC, fan-out, deadlines, renderer/panel UI, Codex, Linux, and physical device
acceptance are not part of this foundation.

## Beads handoff

No `bd` command was run, following COMMON.md. The parent should attach this
evidence and update these existing task issues:

- Close `open-quake-3e9.1`, provider decisions, task 1.1, this change path.
- Close `open-quake-3e9.2`, provider contracts/invariants, task 1.2, this change path.
- Update `open-quake-3e9.4` with the completed mock/adapter-port portion;
  keep open for task 1.3, real SDK adaptation, and ChatService acceptance.
- Update `open-quake-3e9.5` with the completed typed host credential/catalog
  portion; keep open for native binding and real settings acceptance.
- Close `open-quake-cby.2`, chat contracts/reducers, task 1.2 under
  `openspec/changes/ai-chat-core/`.
