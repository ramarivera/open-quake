# Design

Keep the existing numeric and `library:<type>:<n>` resolver contracts. Replace
only semantic artwork imports with regular Phosphor raw SVGs. Normalize their
root fill for white tile artwork without duplicate SVG attributes.

Add a lazy Phosphor catalog to the existing icon library, retaining MDI and
custom packs. Continue rasterizing selections through the owned picker bridge.
Use own-property checks for both numeric and type-default maps.

Built-in Quick keys disable artwork editing. The old editor also disabled the
library button, so its click never reached the native picker. Allow browsing
for these keys, explain the lock beside the button, and guard the selection
callback so a library result cannot preview or save locked artwork. Editable
keys continue applying their selection to the current draft. The owner build's
exact selection remains unverified under the explicit no-app constraint.

Exercise renderer button clicks and mocked main/preload boundaries in Vitest.
Never launch Electron, the desktop app, hardware tests, or native tests.
