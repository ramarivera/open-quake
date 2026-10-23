# Tasks

## 1. Beads (open-quake-sr1.1)

- [x] 1.1 Back up `.beads/embeddeddolt` to scratch before migrating
- [x] 1.2 `bd migrate --force`; `bd stats` reads all 8 issues
- [ ] 1.3 `bd dolt push` to publish the migrated schema (awaiting Ramiro's go-ahead)

## 2. Lint (open-quake-sr1.2)

- [x] 2.1 Reproduce: `pnpm run lint` with and without build output, and under `codex sandbox`
- [x] 2.2 Force-ignore build output, enable VCS ignore-file
- [x] 2.3 Verify exit 0 with `out/` present and negative `any` probe fails
- [x] 2.4 Root-cause: rtk lint filter mislabels pnpm exit 254 (no node_modules) as OOM; reproduced in a fresh worktree
- [x] 2.5 repo-gates.sh names the missing-dependency case; test suite stops deleting repo-gates.sh
- [ ] 2.6 Untrack committed `.turbo/*.log` files (follow-up bead)

## 3. Truth Mirror (open-quake-sr1.3)

- [x] 3.1 `enabled = false` in `.truth/config.toml`
- [x] 3.2 `truth_disabled` skip in hook consumers; missing config still fails closed
- [x] 3.3 Hermetic `scripts/test-hook-consumers.sh` with off-switch cases
- [x] 3.4 Record the decision in `.truth/TRUTH.md`

## 4. OpenSpec (open-quake-sr1.4)

- [x] 4.1 Open changes for 2qs.5, 2qs.6, 2qs.7 with epic beads
