Current scope: key-library-parity supersedes the historical hotkeySwitch deferral below using MAIN-067. See its verification.md for alternation, timer and sequencing evidence.

# W3 verification, 2026-10-23

Tasks 1.1 through 1.4 are implemented on `lane/key-function-library`. Tasks 2.x,
3.x and 4.1 remain open. This records device-domain evidence, without claiming
native OS, desktop editor or hardware integration.

- 1.1, parent bead `open-quake-r7r.1`: design.md and proposal.md record approval
  on 2026-10-23. The spec introduction no longer says decisions are pending.
  hotkeySwitch remains unresolved and inactive. `openspec validate
  key-function-library` passed before implementation and after these edits.
- 1.2, parent bead `open-quake-r7r.2`: `packages/device/src/actions/action-registry.ts`
  declares all 12 host leaf functions and profile, knob, clock integration
  descriptors. `action-contracts.ts` provides their schemas. Registry tests
  verify capabilities, policies, support flags, aliases, independent defaults,
  Unicode text limits, chord grammar, exact media identities and integration
  input validation. Runtime availability requires actual adapter support.
- 1.3, parent bead `open-quake-r7r.3`: `action-import.ts` normalizes the contextual
  next-track defect, exact English/Chinese hotkey capture prompts and empty
  trailing text-enter objects. Tests retain originals, preserve previous-track,
  unknown records, timing, alternate visuals and hotkeySwitch, and check
  idempotence with generated JSON. Fixtures are independently authored; their
  read-only research paths are cited in `packages/device/test/actions/action-fixtures.ts`
  and `packages/device/src/actions/README.md`.
- 1.4, parent bead `open-quake-r7r.4`: `action-service.ts` consumes only explicit
  normalized activations matching an injected committed snapshot. Tests exercise
  actual outbound fake-adapter calls for text/enter ordering, app references,
  hotkeys and all eight media commands. Invalid/unavailable actions cause zero
  host calls. Held presses, duplicates, repeats, holds, release, stale revisions,
  old sessions and concurrent duplicate publications do not repeat side effects.
  Failure tests assert distinct catalog identity, private original cause, bounded
  scrubbed serialization, preserved configuration and no automatic retries.

Final required gates, all exit 0:

- `pnpm install`: all 7 workspace projects, lockfile current, no dependency changes.
- `pnpm run lint`: 81 files checked, no fixes or warnings.
- `pnpm run typecheck`: 6 successful tasks, device rerun and 5 unchanged-package
  results reused from Turbo cache.
- `pnpm run test`: 3 successful tasks. Device rerun, 81 tests in 8 files, including
  45 new action tests. Protocol 25 tests and desktop 87 tests reused from Turbo
  cache. Total 193 passing tests represented by the run.
- `openspec validate key-function-library`: valid.
- `git diff --check`: no whitespace errors.

Earlier focused run `pnpm --filter @open-quake/device exec vitest run test/actions`
passed 44 action tests before the final integration-schema test was added. The
final repository test gate includes all 45 action tests.

No apps/desktop file changed, so the conditional desktop build gate did not
apply. No dependencies were added. The only shared-file code change is one
namespace export line in `packages/device/src/index.ts`.

Unverified and remaining: real OS permissions and native host effects, modifier
cleanup inside future native adapters, physical key mapping, actual profiles/
knob/clock composition, UI/IPC wiring and hardware behavior. Those remain with
the owning lanes and tasks 2.x. No DK-Suite process or hardware was started.
Beads was not run; the parent must close/update the four existing issue beads
with this source and verification evidence and keep the epic open.
