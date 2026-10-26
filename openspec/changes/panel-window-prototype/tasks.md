# Tasks

## 1. Slice (built)

- [x] 1.1 Management + frameless panel windows (fba379a)
- [x] 1.2 Stable panel title for the OmniWM float rule (2d56683)
- [x] 1.3 ESM preload + unsandboxed renderers so IPC events flow (2e71f66)

## 2. Close-out

- [ ] 2.1 Run `pnpm --filter @open-quake/desktop dev` and capture both surfaces receiving mock events
- [ ] 2.2 Verify panel placement on the real DK-QUAKE display (terminate DK-Suite afterwards per TRUTH.md)
- [x] 2.3 Add unit tests for `findPanelDisplay` (physical-pixel size priority and strict tolerance, case-insensitive label fallback, ambiguity, none)
- [ ] 2.4 File follow-ups for gaps found, then close `open-quake-2qs.5`
- [x] 2.5 Extract event forwarding and test delivery to both windows, skipping destroyed windows, and delivery to replacements
- [x] 2.6 Test mock bus cadence, unsubscribe, and `stop()` timer/listener cleanup with fake timers
- [x] 2.7 Share `QuakeEvent` between main and preload and type the preload bridge without `any` or untyped event payloads
- [x] 2.8 Handle display add/remove/work-area changes, preserve the panel title, and test window recreation and shutdown cleanup
- [x] 2.9 Run install, repository lint/typecheck/tests/build, and OpenSpec validation

## Verification and handoff

- `pnpm --filter @open-quake/desktop test`: 4 files, 19 tests passed, including the real main entrypoint with Electron mocked. These tests do not prove live Electron or hardware behavior.
- `pnpm --filter @open-quake/desktop typecheck`: passed.
- `pnpm install`: passed. Existing peer warnings remain for electron-vite 5 with Vite 8 and `@effect/vitest` 0.30 with Vitest 4.
- `pnpm run lint`: passed, 37 files checked without fixes.
- `pnpm run typecheck`: passed, 6 successful tasks.
- `pnpm run test`: passed, 3 successful tasks and 22 tests total, including 19 desktop tests.
- `pnpm run build`: passed, desktop main, ESM preload, and renderer bundles built.
- `openspec validate panel-window-prototype`: passed.
- `git diff --check`: passed.
- 2.1 remains unverified. A live desktop run was not required for this lane.
- 2.2 remains unverified. No hardware access or DK-Suite run was attempted.
- 2.4 remains open. The parent owns Beads updates under the lane brief.
- Renderer handoff for L3 or a later lane: import `QuakeEvent` and `OpenQuakeBridge` from `apps/desktop/src/preload/quake.ts`. The renderer's loose redeclaration is untouched.
- OmniWM research: `/Users/ramarivera/dev/open-quake/.context/research/omniwm-quake-notes.md`. No host window-manager settings were changed.

## Device burn-down lane 2026-10-26

- [x] Implement device lane requirements with fixture/TestClock/native mock coverage. Beads open-quake-lih.11.20-.22.
- [x] Run full gates after merging latest origin/main; hand PR to lead with hardware unverified.

Device lane validation: current main `4aa4a9f1` merged. Root test command with SSD TMPDIR passed 4,137 tests with four existing skips. Lint, six-package typecheck, build, bundle smoke, 47 strict OpenSpec items and hidden muted native media smoke passed. EN/DE screenshots and per-row evidence are in the lane scratch directory; hardware stays unverified. Beads remain open for the lead.
