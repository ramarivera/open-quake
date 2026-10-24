# Design

## Context

See proposal.md. Research is local-only under ~/dev/dark-encyclopedia/dk-suite-introspeccion/v0.4.95. OperationConfiguration.vue:2094-2310, 2418-2552, 3225-3318 and MainScreen.vue:2711-2822 establish draft publication. IconSelectContent.vue:415-994 establishes search, zoom and packs. AUDIT_MAIN MAIN-067/075-078/081 identifies the main-process runtime consumers.

## Goals / Non-Goals

Share the existing ProfileRepository between editor and runtime. Preview publication never enters committed dispatch snapshots. Keep the catalog, forced spans, profile manager and knob model intact. Clock settings use the existing clock conductor. Physical resource transfer remains unverified.

## Decisions

- Main owns revision-checked saves and ephemeral target-bound drafts. Renderer unmount/selection change discards drafts; failed saves retain a draft. Committed runtime reads never see previews.
- Keep title origin metadata and userModifiedTitle in encoded profiles. A separate resolver reuses profileText and recovered locale strings, including legacy titles. Explicit edits, even an empty string or an English default, win.
- Load MDI from the approved package, render bounded icon pages and use safe image URLs. Persist imported packs locally. Parse bounded ZIP entries without extracting paths; reject traversal, links, remote SVG references and scripts. Iconfont symbol SVGs are supported without evaluating JavaScript. A TTF-only pack needs an unapproved font parser; record that blocked variant while completing symbol packs.
- Reuse ActionService validation and adapters. Stateful actions use scoped Effect fibers and TestClock coverage. State is session-local and bound to device/profile/key; countdown fibers survive profile navigation. Progress and alarm feedback are hidden when their profile is inactive.
- Wire the merged gesture recognizer into the strip input adapter. Horizontal slide maps to pages, vertical slide to profile groups. In-tile scroll and knob overlays retain ownership.
- MGMT-249 is intentionally corrected: Delete never removes a tile when input, textarea, select or contenteditable owns focus.

## Risks / Trade-offs

- TTF-only iconfont fallback requires another dependency. It remains an explicit blocked variant until approved.
- Host shortcuts and alarm audio require real OS/device checks. Mock smoke proves application wiring only.
- Imported archives can be hostile. Bound compressed/expanded bytes, entry count and image dimensions, decode data before accepting, and never execute pack code.

## Migration Plan

Add optional title metadata without rewriting old profiles. Retain compatibility payloads. Persist icon packs under a versioned local file; no changes to DK-Suite files. Reset runtime state on application restart, and cancel fibers on disposal.
