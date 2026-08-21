# open-quake ground truth

- Never bypass, edit, disable, or reroute the husky / Entire / truth-mirror hook chain (`--no-verify`, hook edits, `core.hooksPath` changes).
- OMP-harness-driven changes are adversarially reviewed by `codex gpt-5.6-terra@low`; do not change the `[pairs.omp]` reviewer without Ramiro's explicit order.
- Every commit message carries an honest CLAIM line; verification claims must match what was actually run.
- Never commit secrets, `.env*` contents, or Entire session artifacts.
