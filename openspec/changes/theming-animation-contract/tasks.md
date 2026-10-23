# Tasks

## 1. Decide

- [x] 1.1 Record recommendations for the five decisions as "Proposed (pending Ramiro)" and define the inventory sections 2/9 boundary
- [x] 1.2 Extend `specs/ui-theming/spec.md` with concrete requirements and scenarios for review
- [ ] 1.3 Parent: obtain Ramiro's decisions and update `open-quake-2qs.7`; proposals are not approval

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
