# Tasks

## 1. Decide

- [x] 1.1 Record recommendations for the five decisions as "Approved (Ramiro, 2026-10-23)" and define the inventory sections 2/9 boundary
- [x] 1.2 Extend `specs/ui-theming/spec.md` with concrete requirements and scenarios for review
- [ ] 1.3 Parent: sync the decisions approved in `20e9fd1` to `open-quake-2qs.7`

## 2. Build

- [x] 2.1 Token system + dark/light themes; replace inline colours in `App.tsx`
- [x] 2.2 User-custom theme loading
- [x] 2.3 Motion policy + reduced-motion handling
- [x] 2.4 Persist, validate, and synchronize appearance between renderer windows; report import/storage failures

## 3. Verify and hand off

- [x] 3.1 Add desktop Vitest using the existing catalog version and unit-test tokens, custom validation, preferences, and motion selection
- [x] 3.2 Exercise both surfaces, live switching, imports, persistence, synchronization, and motion suppression in a browser
- [x] 3.3 Run `openspec validate theming-animation-contract`, install, lint, typecheck, test, and build; record actual results
- [ ] 3.4 Parent: verify animation frame time on the physical 1920x480 panel; no hardware verification claimed by this lane
- [ ] 3.5 Parent: sync epic/task Beads with the PR's source and verification evidence

## Verification evidence

- `openspec validate theming-animation-contract`: valid.
- `pnpm install`: exit 0, lockfile up to date.
- `pnpm run lint`: exit 0, 36 files checked, no fixes or warnings.
- `pnpm run typecheck`: exit 0, 6 successful tasks, 5 cached.
- `pnpm run test`: exit 0, desktop's 57 tests passed; device/protocol's
  3 existing tests replayed from Turbo cache, 3 successful tasks total.
- `pnpm run build`: exit 0, Electron main/preload/renderer bundles built.
- Unit source: `apps/desktop/src/renderer/src/theme/theme.test.ts`.
- Headless Chromium: dark/light management at 1100x760, panel at 1920x480,
  narrow management at 480x760 without horizontal overflow. Exercised native
  theme/motion selects, valid/invalid file imports, inherited colors, reload
  persistence, cross-window sync, corrupt storage fallback, failed storage write
  feedback, and live OS reduced motion. Repeated theme/custom/motion sync against
  production `file://` renderer output with local-file access enabled.
- Synthetic preload callback: rotation/press counters updated on both surfaces;
  normal feedback had one 160 ms animation, keep-alive had none, and emulated OS
  reduced motion suppressed counter animation. This does not verify real IPC/HID.
- Physical-panel frame timing, actual Electron window/IPC behavior, and hardware
  placement remain unverified. DK-Suite was not started.

Beads commands were intentionally left to the parent per the lane brief.

## 4. PR #4 integration and review

- [x] 4.1 Merge `origin/main` without rebasing; keep the shared desktop test script/dependency and include renderer tests in Vitest discovery
- [x] 4.2 Import the shared preload `QuakeEvent` and `OpenQuakeBridge` contracts in the renderer without explicit `any`
- [x] 4.3 Restore defaults and safe feedback on invalid live storage events; keep invalid broadcasts ignored; add event-driven regression tests
- [x] 4.4 Keep cumulative rotation, press, and received-event totals beyond the bounded diagnostic log; add regression tests
- [x] 4.5 Run frozen install, direct Biome, typecheck, tests, build, and strict all-change OpenSpec validation

### Integration verification

- `pnpm install` and `pnpm install --frozen-lockfile`: exit 0. The lockfile was
  already consistent with both branches and did not change.
- `./node_modules/.bin/biome check packages apps`: exit 0, 55 files checked.
- `pnpm run typecheck`: exit 0, 6 successful tasks, 5 cached.
- `pnpm run test`: exit 0, 85 desktop tests passed across main and renderer;
  device's 1 test and protocol's 25 tests replayed from Turbo cache.
- `pnpm run build`: exit 0, Electron main/preload/renderer bundles built.
- `openspec validate --all --strict`: exit 0, 28 changes passed.
- Before the fixes, the targeted regressions produced 3 failures and 6 passes.
  Afterward all 9 passed. Sources: `theme/useAppearance.test.ts` and
  `useQuakeEvents.test.ts` under `apps/desktop/src/renderer/src/`.
- Headless Chromium drove the real management hook through a synthetic preload
  callback. After 401 events the rendered totals were 401 received, 150 rotations,
  150 presses, and keep-alive 142, while unit tests verified the 100-event log cap.
  The panel also retained 150 rotations, 150 presses and keep-alive 42 after 301
  synthetic events, with its `open-quake panel` title intact.
- Headless Chromium selected light/reduced motion, then corrupted storage from
  another same-origin renderer. Existing management and panel renderers restored
  dark/system, management showed safe feedback, and a fresh renderer agreed.
  Invalid BroadcastChannel messages left that state intact.
- Actual Electron IPC/HID, physical panel placement and frame timing remain
  unverified. DK-Suite was not started.

## 5. Strip motion amendment (strip-key-grid)

- [x] 5.1 Record approved parity decision 3: DK strip motion on the key grid, the 160 ms / 4 px budget for management and panel overlays, DK's fixed strip palette; implemented in `apps/desktop/src/renderer/src/strip/strip.css` (bead `open-quake-lih.2.1.5`).
