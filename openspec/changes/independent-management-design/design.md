## Context

Design lead for `open-quake-nyd`. The authoritative cross-lane brief and token file live in the lane scratch (`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-finish/redesign/DESIGN-BRIEF.md`, `design-system.json`); this document records the decisions that shape the management renderer.

## Goals / Non-Goals

Goals: look nothing like DK-Suite; every implemented page is reachable and visible; calm typography-led hierarchy; one container level; a strong single primary action; accessible at 390 px and 1180 px in all themes.

Non-goals: new features, faked capabilities, new dependencies, main/preload changes, strip/panel visuals (nyd.4), chat/agents internals (nyd.3).

## Decisions

1. **Quiet workbench direction.** Neutral graphite/paper surfaces and a single jade accent (`#5fcab5` dark, `#0b7466` light). Rejected: an indigo/violet accent (generic AI look) and keeping DK's white accent on dark (gives no primary action affordance).
2. **Keep the nine-token custom-theme contract.** Only the built-in values change, so imported custom themes still validate. Danger and accent-ink are derived in CSS rather than added to the contract.
3. **`--oq-*` semantic layer, `--mc-*` aliases.** Peers write against stable semantic names, and older selectors keep working during the transition.
4. **Unbox `.mc-panel`.** Most nesting came from `.mc-panel > fieldset/.mc-card`. Making the panel an unboxed section removes the nesting everywhere, with no page rewrites.
5. **Labelled navigation at every width.** 32 px rows let all 13 pages fit at 1180×860. Below 760 px a drawer replaces the rail, because icon-only navigation was explicitly rejected. The drawer is a disclosure (`aria-expanded`, `aria-controls`), closes on Escape and selection, and returns focus.
6. **Accessible names stay stable.** `button[title="UI Settings"]`, `input[name=mc-theme|mc-font]`, `.mc-resizer`, `.content-inner[data-page]`, `#agents-tab-*` and the status regions keep their contracts, so existing tests and smokes still drive the app. Visible labels may change.
7. **Flat device preview.** The real StripScreen canvas sits in a 1 px frame, with no bezel gradient, knob cap or detent ring. Live input reads as numbers plus a recent-activity list.

## Risks / Trade-offs

- The root smoke asserts DK geometry (`.sidebar` width `82px` at 820 px) → parent seam request; the lane verifies with its own hidden capture harness instead.
- Panel/strip read `--quake-*` too, so dark accent changes from white to jade there → coordinated with nyd.4, which moves the strip onto a fixed device palette.
- Changing the default palette changes the first-paint native background → renderer already sends the theme colours. Main's first-run fallback is a one-frame mismatch, reported to the parent.
