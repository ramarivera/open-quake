# Design

## Context

See proposal.md. Research is local-only under `~/dev/dark-encyclopedia/dk-suite-introspeccion/v0.4.95/`: `app-resources/background.js`, `audit/AUDIT_MAIN.md`, `audit/AUDIT_SCREEN.md`, `audit/AUDIT_AI.md` and recovered sources. No hardware opens are permitted during implementation.

## Goals / Non-Goals

Deliver the vendor reader through the existing QuakeDevice connection and its event stream. Keep geometry and action execution injectable. Implement ordinary keys and reusable sub-target input, not voice-start policy, widget visuals, or a replacement profile grid.

## Decisions

- Parse raw bytes before the control protocol decoder. Header bytes 0 and 3 are A3/1A; byte 4 is count; each contact is action,yLE,xLE. Bytes 1/2 and trailing padding remain opaque. Accept 0–5 contacts only when all bytes exist. No checksum is inferred. Invalid frames cannot extend contact lifetimes.
- Reproduce nearest-neighbour matching within 99 px, consuming each new contact once. DK-Suite ignores the action byte when tracking and marks every reported point active. Preserve the raw action in the parser but use presence for tracking. Missing contacts emit up before new/moved contacts. Idle release removes contacts, improving DK-Suite's stale last-frame behavior. IDs are deterministic monotonic session IDs instead of time/random strings.
- Own touch binding in the control connection scope, reusing HidTransport but selecting all four touch identity fields. Touch read failures release contacts, close the handle and retry without disconnecting the control channel. Acquire native opens with Effect.acquireRelease so cancellation waits for any late handle and closes it exactly once. Never write to the touch handle. Retry every 2 s, five failures per cycle, then 10/15/20/25/30 s recovery, at least 60 s for empty enumeration. State/counters contain no native path or raw exception text. Expose generation-cancelled wake recovery and lock/capture controls.
- Use bottom-left to top-left conversion followed by the recovered 90/180-degree double flip. The native portrait canvas rotates through existing CSS; sub-target bounds can transpose separately. Keep logical coordinates distinct from browser viewport coordinates.
- The renderer contract is a resolver `(point, layout) => TouchTile | undefined`. TouchTile owns only keyCode, supportTouchEffect and optional sub-targets. strip-grid owns layout and geometry. The mounted panel calls strip-grid geometry.tileAt against the layout actually painted by StripScreen. Grid data-key-code hosts locate sub-targets only; ordinary tile hit-testing never depends on DOM rectangles. Held ordinary keys drive StripScreen press feedback and emit strip-key events for the action lane.
- Capture the first point for all phases; an up anywhere on the strip releases the held ordinary key after 10 ms. One ordinary key at once, no slide-off cancellation. An overlay captures its whole gesture. Sub-targets defer clicks, permanently cancel tap after 16 px slop and hand off to scroll. The 500 ms tap limit is inclusive. Child and sub-target attribute mutations invalidate registry membership; eligible local rescans run before accepting existing hits and stay throttled to 500 ms. Gesture samples retain their original coordinates and timestamps, correcting the recovered recognizer's reassigned timestamp at axis lock.
- Keep system-monitor and message-list scroll policies separate. Monitor uses exponential decay to 0.05 per second, 64 ms step clamp, 600 ms hard stop, 0.15 launch/0.02 rest thresholds, 0.5 rubber damping capped at 32 px and 200 ms cubic return. Chat uses its recovered 96 px/event cap and 0.95/frame friction with fast-flick gating.
- Mock mode must work in built apps. Synthetic raw frames traverse the same parser/tracker; no native transport is evaluated. The opt-in capture script requires an explicit flag, writes only into lane scratch and refuses competing app processes before opening only FF73/71.

## Risks / Trade-offs

Physical report ID/length, raw action meaning and coordinate ranges need recorded hardware evidence. Synthetic fixtures explicitly identify their provenance. A five-contact bound follows SCREEN-053 and prevents malformed packets from creating arbitrary contacts. Cross-lane consumers must attach the resolver/key sink and capture controls; the README specifies those contracts.

## macOS pointer correction

Read-only native enumeration on the connected controller shows five usage entries sharing exactly one device path. Pinned node-hid3.4.0 HIDAPI/mac/hid.c derives those paths from IOHIDDeviceGetService and opens that shared IOHIDDevice; exclusive mode selects kIOHIDOptionsTypeSeizeDevice. Earlier source notes assumed these were independent devices, but the path evidence disproves that assumption on this controller. Use `nonExclusive:false` only for `isTouchDevice(info)` on Darwin. No sibling handles, event taps, global input or firmware commands are needed. Existing scope/recovery owns close/reopen. A native open/close proves ownership can be acquired and released; physical touch still must confirm cursor suppression and correct app routing.
