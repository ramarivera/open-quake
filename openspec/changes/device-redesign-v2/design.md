# Design

## Context

The merged app can stop answering its control endpoint while the native stack is in NSAlert runModal. Recovery by restarting succeeds but the freeze recurs. A meeting-capture window existed during the frozen state. A focused Electron43 test then reproduced unparented alerts blocking JS timers and abort signals; parented alerts remained responsive. This proves the native-dialog failure mode, while the original user incident trigger remains unproven. Knob context currently copies raw profile names even though thumbnails use translated profiles. Native temperature collection explicitly marks unsupported-on-mac. A cold monitoring snapshot can be expected without active demand, so sampling must be tested through its actual watch path.

## Goals / Non-Goals

Goals are durable responsiveness fixes, current default branding, stable picker actions, truthful supported metrics and two complete design choices. This effort does not silently select a visual direction, rewrite custom profile names, fabricate sensor data or claim physical/provider acceptance from mocks.

## Decisions

Use existing profile translation at the knob boundary and preserve stored data. Reuse localized Apply and retain Current separately. Diagnose the frozen main process before choosing its fix; capture errors before restart. Test monitoring admission and collection independently of capability limitations. Live watch confirmed all8modules after warm-up once the parser accepted macOS device_connected as well as the legacy devices_connected field. Parent meeting dialogs to the live management window, fail safely when absent, and bound the capture-fallback prompt to60seconds. Keep all design mockups in scratch and present their full inventory in T3 using direct HTML/images, without nested iframes.

## Risks / Trade-offs

Native dialogs and audio acquisition need bounded ownership and teardown; a restart alone is not a fix. Full redesigns may need shared geometry changes after selection. Temperature support may require a new platform integration, which is not authorized merely by a blank reading. Unsupported sources must remain explicit.


## Selected visual direction, 2026-10-29

Signal Deck is approved as the visual language for device and Studio. Its proposed left navigation rail, new scene compositions, reduced key geometry and alternate profile-list layout are not approved. Preserve existing geometry, hit targets, pages, tile spans, actions, wallpaper media and explicit user artwork/title/style choices. New profiles and layout authoring are future requests.

Use semantic palette roles for canvas, panels, text, secondary text, control boundaries, primary action, selection, success, warning and failure. Existing theme IDs and version2 appearance records remain valid. Device components consume the same selected theme as Studio, including previews. Add familiar editor/product-inspired palettes and correct native light/dark chrome. Signal Deck identity comes from instrument-style typography, restrained corners, channel rules and clear status accents across every current renderer.

The background capability remains. Ambient replaces the disliked default Vivid/BB wording without changing stored profile identifiers or custom names. New backgrounds are additive and do not overwrite existing playlists. Reactive visuals must respond to actual audio that the user chooses to supply; sample previews must identify sample energy, and idle/unavailable inputs stay explicit. No incidental microphone or system-audio capture is allowed during verification.

Ambient presentation is a per-device renderer appearance preference synchronized between windows through the existing origin's storage events, without changing the wallpaper IPC or file schema. Media save/cancel stays independent and the UI says styles apply immediately. Original Media preserves the existing playback path; Contour, Horizon and Plotter add procedural art. Lava and Ambilight analyze only enabled background-video audio through a captured media stream. No microphone or system capture is started. Streams, graph nodes, contexts and animation frames are owned by the active media layer and released on pause, replacement, hiding or unmount. Silent, missing and unsupported audio are distinct visible states.
