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

## Narrow runtime header and pending-source recovery (nyd.3.5)

Hidden mock Electron harness (opacity 0, prohibited activation) on the actual root, against the synthetic Hermes API, true 390x625 content:
- Folded header: 41px instead of 134px. The transcript shows 297px instead of 204px, and 3 messages instead of 2.
- Keyboard:
  - Tab from New chat lands on Details, because the folded controls are out of the tab order.
  - Space opens Details. Tab then reaches Test connection, then Model route.
  - Enter closes Details. Focus stays on the toggle, and `aria-expanded` and `aria-controls` resolve.
- Preserved across fold, unfold and a width switch: the composer draft, 6 messages, pinned-to-end scroll, and the chosen model route. The route stays named in the folded row.
- German locale: the toggle reads "Details".
- At 1180, the header height (178px) and the selectors used by `runtime-desktop-e2e.ts` match the base. The screenshot differs from the base only in the random port digits.
- A failed select, forced with read-only runtime storage (`AGENT.HTTP.STORAGE.FAILED`), keeps every source visible at 390. Enter on Direct model recovers. On the base commit the same run reproduces the trap: no source is visible.
- The audit found no overflow, unnamed controls, duplicate ids or contrast failures in any of the 9 states.

Artifacts: `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-finish/redesign/header-final/` (`harness/`, `shots/header3-*`, baseline `shots/base-*`).

## Not verified here

- The runtime container E2E (`runtime-desktop-e2e.ts`) was not run, because it needs disposable containers. Its selectors were kept by design; only the tab label changed.
- Live providers, physical QUAKE, microphone and audio were out of scope.
- Locale switching depends on the parent's i18n provider. This lane delivers dictionaries and seams only.

## Parent integration acceptance, 2026-10-25

The locale-aware combined app includes the Opus narrow workspace rework.
The direct-chat native smoke passes at true 390 by 625 and 1180 by 625,
with the newest exchange and composer visible. A rejected oversized host
submission retains the editable draft and produces no provider request.
The controller regression also distinguishes accepted submissions from
rejected or duplicate submissions.

Real disposable Hermes and OpenClaw each passed selected desktop routing,
streamed rendering, two-turn remote continuity, production shutdown and
container/network/volume teardown. Inference used the authorized gpt-6.1-sol
model with a generic environment-configured provider. No tools were enabled.
Locale switching during a direct stream preserved the active request and
translated Stop without reloading the renderer.

Artifacts are outside the repo under
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-finish/redesign/`:
`integrated/direct-chat-IMnRjy/` and `runtime-final/desktop-e2e-QlVZ5A/`.
PR47 review fixes and merge remain pending. Physical QUAKE and microphone/audio
acceptance are separate and remain unverified.

The actual-root synthetic Hermes regression also holds a reply open, opens the
connection details sheet, verifies Edit and Remove are disabled, attempts both
clicks, and confirms the selected connection and running reply survive until
explicit Stop. Evidence: `redesign/review-runtime/stream-guard-B59KBB/` under
the external scratch root.
