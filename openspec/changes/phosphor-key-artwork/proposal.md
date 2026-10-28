# Phosphor key artwork and working icon library

## Why

The management Keys page's icon library button does nothing on the owner's build.
Built-in key artwork must use Phosphor rather than DK-derived or MDI glyphs.

## What changes

- Fix the icon library opening path and cover a button click through the bridge.
- Use regular Phosphor SVGs for numeric built-in IDs and semantic type defaults.
- Offer Phosphor in the icon library while preserving custom and existing MDI choices.
- Guard artwork lookups against inherited properties, add panel brightness artwork,
  and use microphone mute for Discord mic mute.

## Impact

Adds only the approved `@phosphor-icons/core` dependency. No device protocol,
stored custom icons, schema, or CI changes. No live app or hardware tests.
Execution: open-quake-di9, open-quake-jxh, artwork portion of open-quake-l86.24.
Epic: open-quake-bj1.
