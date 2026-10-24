# Design

## Context

The desktop currently picks label-first using logical size and reconnects every second. QuakeDevice owns the HID scope; this lane extends that abstraction instead of opening another handle. Research is local-only at ~/dev/dark-encyclopedia/dk-suite-introspeccion/v0.4.95, audit MAIN and recovered renderer plus app-resources/background.js.

## Goals / Non-Goals

Keep one device owner and one panel throughout transient failures. Keep preview available without hardware. Windows native enumeration and DisplaySwitch /extend remain specified future adapters behind a platform check.

## Decisions

- Add only screen-power and recovery controls to the existing device bus. Display discovery is serialized, registers observation before powering off, always restores power on interruption/failure, waits up to 30 seconds, and rejects ambiguous removals. Fingerprint uses rounded size times scaleFactor and the recovered strict <10 tolerance.
- Transient read policy belongs below desktop supervision so keepalive and existing consumers survive isolated EIO. Recognize native EIO at its boundary, count three within ten seconds, force discovery after each, and force reconnect after thirty seconds without recovery. Other read failures remain terminal. Backoff is min(1000+2000*retry,30000), in bursts of five, then passive presence checks; thirty seconds of connection stability resets retry state.
- Use an Effect lifecycle controller with injected display/native edges. Electron owns windows and listeners. Hide immediately on HDMI removal and USB loss; keep the existing strip window through the three-second grace. Release stays hidden without a strip; development can show the primary fallback after grace.
- Acquire requestSingleInstanceLock before whenReady, windows, runtimes or device I/O. Duplicate refuses startup and tells stderr; second-instance restores/focuses management on every platform.
- Reuse existing tokens and the recovered diagnostic structure and English locale strings. IPC has schema-decoded commands and replies, main-frame and exact document checks, management identity for mutations, and safe error identities only.
- macOS uses a fixed osascript JavaScript/CoreGraphics adapter, with no shell interpolation. Probe is read-only. Consent describes CGConfigureDisplayMirrorOfDisplay and CGConfigureDisplayOrigin, including demotion of a strip primary and movement to the far right. Never call a native fix without consent, never in mock mode. Missing/broken adapter returns a recoverable catalog error. Windows offers system display settings; a future DisplaySwitch /extend adapter must require consent.
- A read-only system_profiler probe recognizes a named QUAKE mirror omitted by Electron on first launch. It offers Display Settings; automatic layout repair requires a visible target ID. Failed pairing leaves HDMI failed even when an unpaired candidate has valid dimensions.

## Risks / Trade-offs

Native display IDs and off/on enumeration need lead-owned hardware verification. Timeout restores power and keeps diagnostics reachable rather than guessing among candidates. CoreGraphics layout changes are unverified on hardware and remain opt-in. Recovered code uses <10, although the audit says ±10; this lane follows the source and tests the boundary.
