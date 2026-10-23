# Design

## Open decisions (grill before implementing)

1. Token carrier: CSS custom properties vs. Effect config vs. both.
2. User-custom theme format and where it is stored.
3. Animation budget on the panel path (frame-time target, what may animate).
4. Motion library (`motion/react` is the candidate) or CSS-only.
5. Reduced-motion: OS setting only, or an in-app override too.

Requirements in `specs/ui-theming/spec.md` cover only what the map already fixes.
