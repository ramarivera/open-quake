# Proposal

## Why

Wayfinder grilling ticket `open-quake-2qs.7`: the map requires the app to be
fully themeable with mandatory micro-animations on both the panel and the
management plane, but "fully themeable" has no concrete contract yet. The
prototype renderer hardcodes colours inline (`App.tsx`).

## What Changes

- Decide (via grilling) and then implement one theme token system shared by
  the panel and management surfaces, with dark and light themes plus
  user-custom themes.
- Define the animation budget for the 1920x480 panel path and how
  reduced-motion is honoured.

## Capabilities

### New Capabilities
- `ui-theming`: theme tokens, theme switching, motion policy for both surfaces.

### Modified Capabilities

## Impact

`apps/desktop/src/renderer/**`. Possible new dependency (motion library) needs
Ramiro's approval. Beads: epic for this change, `open-quake-2qs.7`.
