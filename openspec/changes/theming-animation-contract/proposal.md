# Proposal

## Why

Wayfinder grilling ticket `open-quake-2qs.7`: the map requires the app to be
fully themeable with mandatory micro-animations on both the panel and the
management plane, but "fully themeable" has no concrete contract yet. The
prototype renderer hardcodes colours inline (`App.tsx`).

## What Changes

- Record five recommendations (approved by Ramiro, 2026-10-23) and implement one theme token system shared by
  the panel and management surfaces, with dark and light themes plus
  user-custom themes.
- Define the animation budget for the 1920x480 panel path and how
  reduced-motion is honoured.

## Capabilities

### New Capabilities
- `ui-theming`: theme tokens, theme switching, motion policy for both surfaces.

### Modified Capabilities

## Impact

`apps/desktop/src/renderer/**`, plus desktop package/lockfile test setup using the
existing Vitest catalog pin. CSS-only motion adds no runtime dependency. The five
design recommendations and the new desktop Vitest devDependency remain pending
Ramiro's approval. Beads updates are handed to the parent lane; this lane runs no
Beads commands. Existing planning ticket: `open-quake-2qs.7`.
