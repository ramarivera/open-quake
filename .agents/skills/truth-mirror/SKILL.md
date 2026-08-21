---
name: truth-mirror
description: Use when working in a truth-mirror-governed repo (core.hooksPath points at .truth-mirror/hooks), when a commit is rejected for a missing or invalid CLAIM line, when authoring TRUTH.md ground-truth constraints, or when inspecting or resolving adversarial review verdicts in the truth-mirror ledger.
---

# Truth Mirror

Truth Mirror is an adversarial oversight harness for coding-agent commits: a
separate reviewer model checks every commit's stated claim against its diff and
records verdicts in a ledger. Treat its gates as law, never as friction.

## Commit protocol

Every commit message must contain one line of this exact shape:

```
CLAIM: <what this commit does> | verified: <how you verified it> | evidence: <file path or command>
```

- The claim must be checkable against the diff. Write what IS true, not what
  you hope is be true.
- `verified:` names the verification actually performed (command run, test
  suite, manual check). `evidence:` points at a file or command a reviewer can
  open or re-run.
- Rejections: `missing CLAIM: line`, `what field is empty`, `missing verified
  field`, `missing evidence pointer`. Fix the message; never bypass the hook.

## Ground truth files

The reviewer discovers inviolable constraints from `TRUTH.md`, `AGENTS.md`, and
`CLAUDE.md` (shallowest path first; the repo-root files win the context
budget). `TRUTH.md` should hold only constraints that must NEVER be violated —
short, declarative, one rule per line or bullet. If your change would conflict
with a ground-truth rule, stop and surface it instead of committing.

## Working with the ledger

- `truth-mirror ledger list` / `show` — inspect verdicts on past commits.
- `truth-mirror ledger resolve` / `waive` — close out findings (waivers need a
  reason; empty reasons are rejected).
- `truth-mirror review [SHA|--staged]` — run the reviewer on demand.
- `truth-mirror reinject` — unresolved findings are reinjected into the agent
  prompt surface; addressing them beats re-encountering them.
- An open rejection can block mutating tool calls (the pre-tool-use gate).
  Resolve or legitimately waive before pushing more work on top.

## Never do

- Never bypass, edit, disable, or reroute the hooks (`--no-verify`, hook file
  edits, `core.hooksPath` changes).
- Never write a CLAIM that overstates verification. An honest "verified:
  typecheck only" beats a false "verified: full test suite".
- Never delete or hand-edit `.truth-mirror/` ledger state to make findings
  disappear.
