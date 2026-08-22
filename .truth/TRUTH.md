# open-quake ground truth

- Hook chain is husky -> truth-mirror, enforced strictly. Entire is INTENTIONALLY excluded from this repo (Ramiro, 2026-08-22: "lets have git husky and truth in that order and leave entire out for now until a onyxio agent figures it out"). Do not re-add Entire hooks, plugins, or wrappers without his explicit order.
- Never bypass, edit, disable, or reroute the husky / truth-mirror hook chain (`--no-verify`, hook edits, `core.hooksPath` changes).
- OMP-harness-driven changes are adversarially reviewed by `codex gpt-5.6-terra@low`; do not change the `[pairs.omp]` reviewer without Ramiro's explicit order.
- Every commit message carries an honest CLAIM line; verification claims must match what was actually run.
- `.husky/post-checkout` local-skill propagation is best-effort convenience, NOT an enforcement gate: if the copy fails, the worktree proceeds without the local-only skill. It copies only individual paths git confirms as ignored (never a whole folder, so unignored siblings cannot leak); tracked skills stay revision-owned.
- The truth-mirror gate must deny the protected operation when its binary or config is missing; hooks may not fall back to allowing.
- Never commit secrets, `.env*` contents, or agent session artifacts.
