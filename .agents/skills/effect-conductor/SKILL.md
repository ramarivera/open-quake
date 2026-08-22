---
name: effect-conductor
description: The conductor law for Effect-TS codebases - layered domain modules (contracts/invariants/repository/service), contract-first @effect/rpc transports with Elysia thin edges, the error catalog kernel with scrubbed diagnostics, capability registries, and the AI facade exception. Use when designing or reviewing an Effect service layer, wiring transports, modeling domain errors, or extracting a new conductor module.
---

<!-- Vendored from toolbox: home/chezmoi-externals/skills-source/effect-conductor (canonical). Update there, then re-copy. -->

# Effect Conductor

The conductor is a repo's service layer: one `Effect.Service` module per
domain that owns business logic behind Schema contracts, with persistence,
transport, and UI kept at the edges. The law below is distilled from ONYXIO's
`lib/conductor*` + `lib/domain-base` and foundry's `packages/conductor`, where
it runs in production under CI enforcement.

## The law

1. **Domain logic lives in conductors** - `Effect.Service` modules. Raw SDKs
   and IO libraries never appear above or beside them; they are wrapped.
2. **Dependencies are declared in the service**, not provided at usage sites
   (`dependencies: [...]` on the service; flat `Layer.mergeAll` /
   `Layer.provideMerge` at app root).
3. **Every public method is `Effect.fn("Service.method")`** with explicit
   `Effect<Success, Error>` annotations. Tracing is part of "done": a
   FE→BE→FE round trip must appear as one distributed trace.
4. **Errors are per-reason `Schema.TaggedError`s from the error catalog**
   (below) - never generic `NotFoundError`/`BadRequestError`, never message
   text branching.
5. **Contract-first transport**: endpoints are `@effect/rpc` (`RpcGroup`)
   schemas first; handlers and the typed client derive from them. Thin
   REST/SSE edges over conductors use Elysia (Schema-decoded), never Express.

## Module decomposition

A conductor domain decomposes into cohesive files, each independently
testable:

| File | Owns |
|---|---|
| `<domain>-contracts.ts` | Public Schema types: inputs, outputs, expected results |
| `<domain>-invariants.ts` | Total pure predicates and computations (no Effect) |
| `<domain>-repository.ts` | Persistence behind an interface (`Effect.Service`) |
| `<domain>-service.ts` | The conductor: `Effect.Service` composing repos + infra |
| `<domain>-service.test.ts` | Unit + `fast-check` property coverage |

Pure logic goes to invariants so property tests need no runtime; repositories
are interfaces the service depends on; only the service knows the composition.
Keep files small - if a method group outgrows the file, split by sub-domain
(`admin-service-methods.ts` style splitting is the sanctioned pattern).

## Error catalog kernel

Model every failure through a catalog entry carrying a stable machine code,
category, canonical diagnostic message, and handling policy:

```ts
export const Errors = {
  UserLoadFailed: {
    code: "APP.USER.LOAD_FAILED",
    category: "dependency",
    diagnosticMessage: "Loading the user failed",
    policy: {
      presentation: { userFacing: false },
      userRecovery: { recoverable: true },
      automaticRetry: { enabled: true },
    },
  },
} as const
```

Derive classes via the catalog builders (`catalogErrorFields`,
`catalogTaggedErrorClass`, variant maps for finite discriminator sets). Rules:

- Public fields are `Schema.Literal`-pinned to the catalog entry (code,
  category, message); domain fields ride alongside.
- The original unknown cause is retained privately (non-enumerable property /
  WeakMap) and projected into a bounded, privacy-scrubbed `DiagnosticCause`
  chain: fixed depth, truncated strings, no secrets, safe fields only (error
  name, source code, operation, fingerprint).
- Translate errors only at real boundaries (`Effect.tryPromise({ try, catch })`
  → catalog class constructor). Never re-wrap through generic errors.
- Consumers branch on `_tag` / stable `code`, never message text; edge
  adapters allowlist user-visible fields from the policy.
- Test every changed branch with the real consumer: exact identity, original-
  cause recovery, scrubbed serialized projection, broken-dependency behavior,
  and proof the old cause-dropping path was not taken.

Reference implementation: ONYXIO `lib/domain-base/src/error-catalog*.ts`
(`error-catalog-types`, `-diagnostics`, `-builders`, `-policy`). Copy these
four files into a consuming repo's shared kernel rather than reimplementing;
they are dependency-free beyond `effect/Schema`.

## Capability registry (companion pattern)

Every user- or admin-facing ACTION is declared once in a capabilities registry
(id, input Schema, effect binding, permission `read|write|sensitive`, autonomy
`auto|confirm|never` defaulting to `never`, gate) before it is hand-wired
anywhere. UI buttons, agent tools, and future api/cli surfaces fold from that
one registry. Reference: ONYXIO `lib/capabilities`.

## AI facade exception

Prefer branded `@effect/*` packages over raw SDKs - with one standing
exception: the AI provider layer is an `Effect.Service` facade shelling to the
**Vercel AI SDK** (provider chosen via `Config`), **not `@effect/ai`**. The
facade keeps named spans, catalog-tagged errors, Config, and Layers; outputs
are labeled as estimates/generations, never facts. Tests and CI default to a
mock provider.

## Gates that make the law enforceable

- Patch the Effect Language Server into tsc for CI
  (`npx effect-language-service patch`): floating Effects, missing
  requirements, `catchAll`, bare `try/catch`, `console.log`, `process.env`,
  raw `null`/`undefined` in domain types all fail the build.
- **Consumption rule**: a wiring claim closes only by driving the real
  consumer and asserting outbound behavior changed AND the old path was not
  taken. Layer-provision tests prove packaging, never wiring.
- Property tests (`fast-check`, `@effect/vitest` `it.prop`) wherever
  invariants exist; Schema round-trips pair natively.

## Reference implementations

Paths are from the canonical local checkouts:

- Conductor services + splitting: `~/dev/ONYXIO_APPS/replit-onyxio-app-2026/lib/conductor/src/`, `lib/conductor-base/src/`
- Minimal single-file conductor exemplar: `~/dev/foundry/packages/conductor/src/agent-run-task.ts`
- Per-reason domain errors with HttpApi status metadata: `lib/domain-base/src/errors.ts`
- Error catalog kernel (copy these): `lib/domain-base/src/error-catalog*.ts` - most complete materialization seen on worktree `/Volumes/ExtSSD/devplane/effect-error-taxonomy-20260820/catalog-kernel-materialization`; verify `main` first, else lift from that worktree
- Transport rulings + capability registry: `AGENTS.md` "Non-negotiables" and `lib/capabilities/`

## Related skills

- `effect-best-practices` - service definition, Schema/brands, layers, Atom
  state; this skill layers the module/transport/catalog law on top of it.
- `effect-testing` - layer-based test isolation for conductors.
- `effect-review` - review checklist enforcing these shapes.
