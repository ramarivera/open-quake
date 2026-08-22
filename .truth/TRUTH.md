# open-quake ground truth

- Hook chain is Husky as sole hook owner -> repository gates first (immediate exit on error) -> Beads, Entire and Truth Mirror run sequentially with saved statuses; the operation is rejected if any consumer errored (migration topology, Ramiro 2026-08-22). `.husky/_` entries are generated state (untracked): bare shims normally, Entire wrappers after its self-heal - BOTH are valid because committed `.husky/<hook>.pre-entire` bridges forward the wrapped path into the real content hooks. Do not remove the bridges or reroute `core.hooksPath` away from `.husky/_`.
- Never bypass, edit, disable, or reroute the husky / Entire / truth-mirror hook chain (`--no-verify`, hook edits, `core.hooksPath` changes).
- OMP-harness-driven changes are adversarially reviewed by `codex gpt-5.6-terra@low`; do not change the `[pairs.omp]` reviewer without Ramiro's explicit order.
- Never leave DK-Suite running or suspended on this host, even paused: a suspended DK-Suite instance held ~506k file descriptors against macOS's 524,288 system-wide file slots, starving OMP/Node (incident 2026-08-22). Terminate it (kill, not SIGSTOP) after any recon session and check the fd budget (`sudo lsof | wc -l` vs `sysctl kern.maxfiles`) before long agent runs.
- Every commit message carries an honest CLAIM line; verification claims must match what was actually run.
- `.husky/post-checkout` local-skill propagation is best-effort convenience, NOT an enforcement gate: if the copy fails, the worktree proceeds without the local-only skill. It copies only individual paths git confirms as ignored (never a whole folder, so unignored siblings cannot leak); tracked skills stay revision-owned.
- The truth-mirror gate must deny the protected operation when its binary or config is missing; hooks may not fall back to allowing.
- Never commit secrets, `.env*` contents, or agent session artifacts.
