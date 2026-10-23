# Proposal

## Why

Three pieces of repo plumbing were broken or unwanted on 2026-10-23: the Beads
store sat on schema v53 with 13 pending migrations (every `bd` read failed with
`table not found: leases`), Truth Mirror carried 22 open rejections and blocked
every push, and the latest rejection claimed `pnpm run lint` died with
"terminated abnormally (possibly out of memory)". Ramiro ordered: migrate
beads, fix the OOM, disable Truth Mirror, open OpenSpec changes.

## What Changes

- Beads embedded Dolt migrated v53 -> v66 on `ramiro-macmini` as the single
  designated migrator (the remote had no `refs/dolt/data`, so no other clone
  could have migrated first).
- The "OOM" was not an OOM. The message is printed by rtk 0.50.0's lint
  filter (not Biome) when `pnpm run lint` exits 254, which it does when the
  checkout has no `node_modules` (`biome: command not found`); the reviewer's
  checkout had none. `.husky/repo-gates.sh` now fails with an explicit
  "run pnpm install" message instead.
- `scripts/test-hook-consumers.sh` no longer deletes the tracked
  `.husky/repo-gates.sh` in its cleanup trap; it parks and restores it.
- Biome lint scope hardened: build output (`out`, `dist`, `.turbo`) is
  force-ignored with `!!` so the scanner never crawls it, and VCS integration
  honours `.gitignore`.
- Truth Mirror disabled through one switch: `.truth/config.toml`
  `enabled = false`, which `truth_disabled` in `.husky/hook-consumers.sh`
  reads to skip the Truth Mirror consumer. A missing config still fails closed.
- OpenSpec changes opened for the open wayfinder tickets.

## Capabilities

### New Capabilities
- `repo-harness`: lint scope and the Truth Mirror off-switch contract.

### Modified Capabilities

## Impact

`biome.json`, `.husky/hook-consumers.sh`, `.husky/{commit-msg,pre-push,post-commit,repo-gates.sh}`,
`scripts/test-hook-consumers.sh`, `.truth/config.toml`, `.truth/TRUTH.md`,
`.beads/` (schema). Beads epic: `open-quake-sr1`.
