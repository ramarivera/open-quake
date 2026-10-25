# Verification

Bead `open-quake-nyd.3` (epic `open-quake-nyd`). Ramiro rejected the DK-Suite imitation on 2026-10-25. This lane redesigned the agents and chat area under the "quiet workbench" brief from the nyd.2 design lead.

## Evidence (renderer-only lane, hidden mock Electron, no hardware or live provider)

- Unit and render tests: the management renderer tests pass (89). They cover:
  - Controller races: delayed-acceptance Stop, rejected cancel, stale refresh, latest-conversation reopen, and the clearing guard.
  - Effective main-agent model scope.
  - Inert prose: no script or image elements.
  - Setup, loading and read-failure states.
  - The QUAKE destination copy.
  - en/de dictionary key and placeholder parity for the `chat`, `agentHttp` and `agents` namespaces.
- Full desktop suite: 1296 tests pass with an external TMPDIR. Typecheck and Biome pass.
- Actual root/preload/React: a scratch copy of the parent `direct-chat-smoke.ts` passes. The only change in that copy is the tab label "Conversations". It covers stream, inert markup, history continuation, 1180 and 390 without overflow, Stop, failure code, rename and delete.
- Parent `review-smoke.ts` passes on this lane with two renamed labels: "Add model" and "Per-agent models".
- Hidden mock harness against a synthetic OpenAI-compatible provider and a synthetic Hermes API (status, tool progress, usage), run on the design lead's shell. It captured:
  - States: unconfigured, empty, conversation, streaming, failure, add connection, Hermes conversation, library, skills, edit agent, models, and DK-Claw keys.
  - Sizes and themes: 1180 and 390 in the Graphite, Paper and Midnight themes.
  - An automated audit at each state found no unnamed controls, unlabelled fields, duplicate ids, WCAG text-contrast failures or horizontal overflow. An injected low-contrast canary and an unnamed-button canary proved the audit detects both.
- Native keyboard events: Enter sends, Shift+Enter doesn't send, the composer clears, and focus returns after the reply.

Artifacts are kept outside the repo in `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-finish/redesign/chat/`:
- Before shots: `shots/before-WoVY2y`, `shots/before2-*`.
- Final integrated shots: `shots/final5-1ixsIO`.
- The harness and audit script: `harness/`.
- Smoke results: `direct-smoke/`, `review-smoke/`.

## Not verified here

- The runtime container E2E (`runtime-desktop-e2e.ts`) was not run, because it needs disposable containers. Its selectors were kept by design; only the tab label changed.
- Live providers, physical QUAKE, microphone and audio were out of scope.
- Locale switching depends on the parent's i18n provider. This lane delivers dictionaries and seams only.
