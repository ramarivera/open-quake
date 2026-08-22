# open-quake agent guidance

Home of the open-source DecoKee QUAKE controller reimplementation (DK-Suite
parity) plus its harness (husky → entire/truth-mirror).

## Trackers — OpenSpec + Beads, kept in sync

- **OpenSpec** (`openspec/`) is the planning surface. One change per effort:
  `openspec/changes/<name>/` with `proposal.md`, `tasks.md`, `specs/`. Validate
  changes with the `openspec` CLI before implementation.
- **Beads** (`bd`, issue prefix `open-quake-`) is the execution source of
  truth. One **epic** bead per OpenSpec change, one **issue** bead per
  executable task, each referencing its OpenSpec path.
- **Sync rule**: opening an OpenSpec change ⇒ create its epic bead; finishing
  or rescoping a change ⇒ close/update beads with evidence. Never let the two
  diverge silently - if they disagree, fix both in the same commit.
- Session start: `bd prime`. Pick work: `bd ready`. Close only with source +
  verification evidence.
- **Wayfinder** maps are beads issues labeled `wayfinder:map`, child tickets
  as linked issues (see the global `wayfinder` skill).

## Research inputs (gitignored, local-only)

- `.agents/skills/dark-encyclopedia/` - DK-Suite reverse-engineering atlas
  (start at SKILL.md)
- `.context/decokee-quake-fw/` - reconstructed device firmware + protocol docs
- `.context/decokee-quake-template/` - Electron-vite desktop skeleton +
  `modules/quake-device` protocol library

These never get committed; cite them by path instead.

## Skills that govern here

`effect-conductor` · `open-quake-errors` · `effect-best-practices` ·
`truth-mirror` (this repo's hook chain). Load before substantive work in their
domain.

## Host safety

See `.truth/TRUTH.md` - notably: never leave DK-Suite running or suspended on
this machine (fd exhaustion incident 2026-08-22).
