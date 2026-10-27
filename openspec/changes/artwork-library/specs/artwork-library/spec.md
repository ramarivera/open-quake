# Spec Delta

## Purpose

The icon picker and template panel expose local artwork selection and imports. A stable resource contract is needed so editing artwork does not silently claim an unverified emoji-to-device pipeline.

## ADDED Requirements

### Requirement: Stable local artwork catalog

The library SHALL expose built-in and imported artwork with stable resource IDs, name, type, provenance and preview status, support browsing/searching by group/name, and report missing resources without substituting unrelated artwork.

#### Scenario: Library search

- **WHEN** the user searches within imported artwork
- **THEN** only matching imported entries appear and selecting one returns its resource ID

#### Scenario: Missing imported file

- **WHEN** an imported resource's backing file is missing
- **THEN** its preview shows unavailable and existing key assignments retain the ID for repair

### Requirement: Validated file imports

The system SHALL import decoded PNG/JPEG and sanitized static SVG files, cap each file at 20 MiB and raster dimensions at 8192 pixels per axis, and reject malformed, scripted or externally referencing artwork before catalog mutation.

#### Scenario: Valid local import

- **WHEN** a supported image is imported
- **THEN** the file is copied into managed storage and its resource ID remains valid after the original file moves

#### Scenario: Unsafe or oversized import

- **WHEN** a selected SVG includes a script or external resource, or an image exceeds a limit
- **THEN** that file is rejected with a reason and no active catalog entry is created

### Requirement: Batch templates and duplicate handling

Template imports SHALL return a result per selected file, preserve successful imports when another file fails, and require an explicit reuse/rename/replace choice for an existing imported name rather than overwriting it silently.

#### Scenario: Mixed batch

- **WHEN** two valid templates and one malformed file are selected
- **THEN** the valid templates are added, the invalid one is reported and existing templates remain

#### Scenario: Duplicate name

- **WHEN** a template name already exists
- **THEN** the user is offered reuse/rename/replace and cancellation preserves the existing file and ID

### Requirement: Transactional artwork selection

Selecting artwork for a key or wallpaper SHALL update only the explicit target through its owning configuration contract. Cancelling selection or losing that target SHALL leave current assignments intact.

#### Scenario: Choose for one key

- **WHEN** the picker opened for key A applies a resource
- **THEN** A references that resource and key B remains unchanged

#### Scenario: Stale picker target

- **WHEN** the target key is deleted before the picker applies
- **THEN** apply reports target-unavailable and does not update a different key

### Requirement: Resource deletion and ownership

Built-in resources SHALL remain immutable. Deleting an imported resource SHALL require replacement or unlinking of active references and SHALL report backing-file deletion failures.

#### Scenario: Referenced artwork deletion

- **WHEN** the user tries to delete an icon used by a key
- **THEN** deletion identifies the references and requires replacement/unlink before removal

#### Scenario: Unreferenced template deletion

- **WHEN** the user deletes an unreferenced imported template
- **THEN** the catalog and managed file are removed and related views refresh

#### Scenario: Application-prefixed deletion reference

- **WHEN** saved or draft keys reference application:<hash>
- **THEN** removing the referenced local icon or pack is rejected

### Requirement: Display-delivery evidence boundary

The library SHALL distinguish a saved local artwork assignment from device-delivery status and SHALL report unverified or unsupported delivery when the active display adapter lacks a verified conversion/transfer contract.

#### Scenario: Local emoji image selected

- **WHEN** a generated image is assigned while emoji packaging is unresolved
- **THEN** the local preview works and physical delivery remains explicitly unverified

#### Scenario: Delivery failure

- **WHEN** an artwork assignment saves but device transfer fails
- **THEN** the assignment remains saved and the transfer error is shown separately

### Requirement: Native picker readiness and target ownership

For MGMT-414 the picker SHALL bind its target token and locale in the owned window URL before renderer loading, replacing the vendor's ready-before-target message buffer. The window SHALL start hidden at 600 by 550 px with the same minimum size and remain resizable. Reopening SHALL cancel the previous operation and create a fresh owned window. Closing the owner entrance, saving its key or cancelling before readiness SHALL dispose the picker, suppress late readiness and prevent stale assignment.

#### Scenario: Target exists before readiness

- **WHEN** an icon picker starts before its renderer is ready
- **THEN** its URL already contains the target token and locale, and cancelling before readiness prevents the late event from showing it

#### Scenario: Reopen or leave the editor

- **WHEN** the user reopens the picker, saves its key or leaves the Keys entrance
- **THEN** the old child closes, any late result is ignored, and a reopened child has a fresh target token

### Requirement: Picker search and progressive groups

For MGMT-415 and MGMT-416 the mounted picker SHALL debounce search by 500 ms across name, tags and extraData, hide groups without matches, and fall back to the first matching group. Local/app groups SHALL appear only when nonempty. MDI SHALL show a pending count until its lazy catalog arrives. No proprietary DK icon pack SHALL ship.

#### Scenario: Metadata match in another group

- **WHEN** a query matches only extraData in an installed pack
- **THEN** that group becomes active, its matching count is shown, and clearing search restores the catalog

#### Scenario: Pending catalog

- **WHEN** library or application loading is pending
- **THEN** progress remains visible, unresolved MDI counts show an ellipsis, and empty local groups stay hidden

### Requirement: Picker selection and resource ownership

For MGMT-417 and MGMT-418 cells SHALL start at 72 px, zoom by 8 within 40 through 120, and render artwork at 60 percent. A chosen cell SHALL show selection and disable repeated activation while rasterization runs. Pages SHALL append ten rows based on viewport width. Intersection visibility at threshold 0.5 SHALL attach and release image sources; unmount SHALL disconnect observers and discard delayed results.

#### Scenario: Scroll and select

- **WHEN** a user scrolls to the page end and selects a visible icon
- **THEN** another ten rows can load, hidden images release their sources, and only the selected cell indicates pending selection

#### Scenario: Zoom bounds

- **WHEN** zoom reaches 40 or 120 px
- **THEN** the corresponding control disables and artwork remains at 60 percent of the cell

### Requirement: Deletion feedback and recovery

For MGMT-421 and MGMT-422 pack and custom deletion SHALL confirm using the display name, preserve storage on cancel or rejection, respect committed and draft references, and show localized success or failure feedback. For MGMT-424 pending, empty group, no selection and zero-result states SHALL offer import, group selection, clear search or retry as applicable.

#### Scenario: Confirmed deletion

- **WHEN** the user confirms deletion of unreferenced artwork
- **THEN** the catalog refreshes and reports success using its display name

#### Scenario: Cancelled or failed deletion

- **WHEN** confirmation is cancelled or storage rejects deletion
- **THEN** the icon remains available and a rejected operation displays its reason with a retry action

#### Scenario: Search has no results

- **WHEN** no group matches a query
- **THEN** the picker explains the empty result and offers a clear-search action

### Requirement: Dedicated picker appearance

For MGMT-425 the dedicated artwork stage SHALL retain a dark #09090b surface and #f4f4f5 text even when management appearance is light. Its accent SHALL follow the existing independent teal design. Focus SHALL have a visible outline, selection SHALL have a distinct border, and destructive controls SHALL use readable danger text. The shared management shell retains its own appearance.

#### Scenario: Keyboard and selection states

- **WHEN** a picker control receives keyboard focus or an icon is selected
- **THEN** computed styles expose a visible focus outline or selection border without relying on hover

### Requirement: Owned artwork resolution and scoped reload

For MGMT-426 and SCREEN-132 GenericTile SHALL resolve inline raster/static sanitized SVG, owned catalog hashes, bundled MDI names and supported app icon aliases through a scoped loader. Arbitrary file paths, file URLs, network URLs, scripted SVG and external SVG references SHALL be rejected. This replaces unrestricted fs/fetch and innerHTML from DK-Suite. A source change SHALL immediately suppress the previous image; stale asynchronous completions SHALL never replace current artwork. DataURL-to-owned-source transitions SHALL re-read the owner, without a permanent resource cache. Visibility listeners SHALL be disposed.

#### Scenario: Owned source replaces data URL

- **WHEN** a tile switches from app pixels to an owned catalog hash
- **THEN** it reads fresh catalog pixels, renders an inert image, and ignores a slower previous result

#### Scenario: Unsafe source

- **WHEN** artwork contains a remote URL, arbitrary local path or scripted SVG
- **THEN** no source is attached and no markup executes

### Requirement: Picture import parity

For MGMT-254 picture selection SHALL accept PNG, JPEG, GIF, WebP and sanitized static SVG up to 5 MiB, limit decoded rasters to 16 million pixels, preserve aspect ratio and rasterize selected artwork to a static 170 by 170 PNG. This picker-specific replacement supersedes the earlier proposed 20 MiB/8192 limits for key icons; template limits remain with their owner. GIF/WebP animation is retained only in the emoji owner, not key-icon selection. Content duplicates SHALL reuse the stored hash without overwriting its name and SHALL report reuse.

#### Scenario: Duplicate or malformed picture

- **WHEN** a picture duplicates stored content or fails decoding
- **THEN** the duplicate reuses the existing entry with feedback, while invalid input leaves the catalog unchanged with an error

### Requirement: Selected tile preview

For MGMT-252 the key editor SHALL show a selected tile card using the real tile renderer, a side of max(80, min(available width,height)) times 0.85, and a 3:2 camera preview. Clock previous/next controls SHALL cycle the selected key's persisted clock theme. Preview artwork SHALL fit within the card.

#### Scenario: Selected clock card

- **WHEN** a selected clock's next theme control is activated
- **THEN** its real preview changes theme without activating a key or changing another key

#### Scenario: Inert selected preview and stale clock completion

- **WHEN** keyboard navigation reaches a selected preview or a clock write completes after another selection
- **THEN** the preview cannot receive focus or activate a key, and stale completion cannot reopen the old selection

### Requirement: Profile thumbnail state presentation

For MGMT-430 each profile row SHALL expose empty, ready, stale, updating, generating and failed states. A retained image SHALL dim while stale or updating, failure SHALL include a readable explanation, and per-row refresh SHALL disable throughout batch work. The preview frame SHALL be 96 by 24 px with an always-visible refresh action. Physical display correspondence remains unverified.

#### Scenario: Refresh and failure

- **WHEN** a row refresh starts or fails
- **THEN** existing pixels remain dimmed during updating, empty rows report generating, and failure displays the explanation while allowing retry after batch work stops

#### Scenario: Thumbnail waits for owned artwork

- **WHEN** a thumbnail includes an asynchronously resolved application icon
- **THEN** capture waits for resolution and successful image decoding before caching the PNG

### Requirement: Artwork geometry across tile sizes

For WIDGETS-008 emoji artwork SHALL occupy floor(min(box) times 0.77) centered in its tile. Game foreground artwork SHALL fit within 95 percent of both box axes. Generic artwork retains the independent design metrics. Preview scaling SHALL scale the same tile geometry and SHALL never move strip hit targets. Live foreground-app acquisition remains dependent on an owned input contract, not a renderer-supplied path.

#### Scenario: Scaled emoji and game artwork

- **WHEN** 1x1 emoji and 4x2 game tiles render in a scaled StripScreen
- **THEN** the artwork fits those metrics and slot geometry stays identical before and after its source changes

#### Scenario: Foreground artwork privacy and sample stability

- **WHEN** monitoring publishes foreground app state or metric-only samples
- **THEN** the panel receives resolved artwork without executable paths, and unchanged normalized foreground identity reuses artwork without requesting a catalog

### Requirement: Internal helper ownership remains explicit

MGMT-413 SHALL use existing configuration replacement/backup merge, emoji download and backup filename consumers. Replacement SHALL persist deletions. Downloads SHALL reject invalid responses before resource commit. Export names SHALL use safe timestamps. Port probing remains open until its DK call site and an existing production consumer are identified. No unconsumed helper copies SHALL be introduced.

#### Scenario: Helper has no artwork consumer

- **WHEN** a recovered helper belongs to another subsystem and lacks a defined artwork use
- **THEN** its obligation stays open with that missing owner or decision recorded

#### Scenario: Existing helper consumers
- **WHEN** a key field is deleted and saved, a generated image fails download, or a backup is exported
- **THEN** the owning consumer preserves deletion, avoids partial image writes, or emits a safe timestamped filename respectively
