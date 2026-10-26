# Desktop wallpaper media

Implements `openspec/changes/device-screen-wallpaper` tasks 1.1–1.5 and cluster 18 tasks 5.1–5.3.
The main process owns selected files, decoding, persistence and the host clock.
The panel and management preview share one renderer on a logical 1920×480
canvas. Since `strip-key-grid`, the strip draws the active profile's key grid;
the wallpaper shows on the vivid screen page, and the clock is the strip's
`dkDesktopClock` tile. That registry entry has exactly one `hourFormat` action,
default `24h`. Main broadcasts one local-time snapshot per second to both views.
The clock stream stops when all windows close, restarts with a new window, and
is interrupted on quit. No firmware clock event is sent.

## Stored schema

The root is `<userData>/wallpaper-v1/`. Settings use
`settings/<sha256(serial)>.json`, with the last valid revision in
`settings/<sha256(serial)>.backup.json`. A save validates before IO, writes the
new primary and previous revision into temporary files, commits the primary,
then rotates the backup. A primary write or rename failure leaves both committed
files intact. A backup rename failure rolls the primary back from the staged
previous revision. Temporary files are removed after either outcome. An
invalid or missing primary can load the validated backup. Updates require the
current revision, so concurrent saves cannot silently overwrite one another.

The version 1 envelope contains `serial`, nonnegative `revision`, `settings`
and `clock`. The device display Schemas define these fields:

- `isTransparent`: false for this release.
- `enableSound`: defaults to false when missing in a version-1 record.
- `bgFillMode`: `contain`, `cover` or `center`, default `cover`.
- `gapInterval` and `gapIntervalUnit`: integer seconds 3–86400 with unit 0,
  or minutes 1–1440 with unit 1. Defaults are 5 and 0.
- `playMode`: `sequential` or `random`, default `sequential`. Multi-item
  playlists switch at each item's duration; a singleton video loops in place.
- `displayMediaList`: zero to 128 ordered items with unique content hashes. Each
  item contains nonempty `name`, `filePath: media:<sha256>` and `duration` in
  milliseconds. Images use `type: image`, decoded `format: image/png|image/jpeg`
  and duration matching the interval. Videos use `type: video`, decoded
  `format: video/mp4|video/quicktime|video/webm` and the probed duration, at least
  2000 ms.
- `clock`: `type: dkDesktopClock` and exactly one
  `{type: hourFormat, value: 24h|12h}` action.

The main-process file picker supplies the source path. A legacy file URL can
be normalized by `importLocal`; its result flags that conversion for display.
The adapter checks content signatures. Images require Electron `nativeImage`
decoding; videos require a hidden, muted Electron metadata probe. Extensions
and caller-supplied MIME types are insufficient.
Imports are limited to 8 MiB and 64 million decoded pixels. This is a desktop
limit and says nothing about device resource limits.

Accepted bytes are copied into `assets/<sha256(serial)>/<sha256(bytes)>`; the renderer receives
a validated image or video data URL, never a filesystem path. Reads verify the content
hash. Deleting the original selected file does not remove its managed copy.
Missing, modified or undecodable managed assets retain their saved selection
and show the neutral background with instructions to select the media again.
Imports never change DK-Suite storage or copy its bundled artwork.

After a successful settings commit, collection removes only files that neither
the serial's current revision nor its backup references. Imports, commits,
restores and collection share the repository lock. Failed commits never collect.
Cleanup failures defer collection without reporting the committed save as failed.
The original flat asset directory remains readable; its collection first validates
all serials' primary and backup settings and retains every referenced hash.
Invalid settings prevent collection rather than risking another serial's asset.

## Status and integration

`desktop-preview` is the initial serial for a clearly labelled preview session.
Management can select an actual serial explicitly. Device discovery and profile
selection can call the same controller later; they do not infer a serial here.
The active serial selection is session-local; each serial's settings persist.

The `wallpaper:request` channel accepts decoded
read/select/import/configure/clear/restore/sound/reorder/remove commands. Import
replaces the list by default; `append: true` adds a new content hash and ignores
duplicates. Reorder requires valid indices and the current revision; moving an
item to its existing index preserves the revision. Remove deletes one index;
clear deletes the whole playlist. The separate `wallpaper:audio` channel accepts
`id`, `serial`, `revision` and `active` to acquire or release panel sound. Only the
app's renderer document and top-level frame may call the handler. The panel
can read and request sound; management can mutate settings. Main supplies the current management window's
identity, so query parameters cannot grant writes. Closing a renderer removes
both subscriptions.
Notifications use `wallpaper:snapshot` and `wallpaper:clock`. Snapshots contain
a versioned saved revision, decoded asset state, `activeIndex`, `playbackId` and
host clock. Images use the existing theme tokens without decorative animation.

`asset: ready` means the desktop decoder accepted the media. Device delivery
is always `unverified` in this lane. Saving and previewing never send HID bytes
or assert hardware application. Tasks 2.x still own resource transfer state,
L1 capability agreement and the separate keyed-icon/full-panel hardware gates.

The desktop adds the existing catalog dependency `effect` 3.22.1. It imports
the display-only device modules directly so Electron builds bundle workspace
TypeScript and renderer bundles never import HID adapters. No image dependency
was added. Shared IPC Schemas live in `src/shared/`, imported by main, preload
and renderer. Main creates a runtime from the exported `MediaLive` Layer and
calls `registerMedia` with a getter for its management window. Registration has
no import side effects. Clock interruption uses that runtime. The quit handler
waits for clock interruption and runtime disposal before allowing Electron to quit.

## Verification

Run the repository gates from its root:

```sh
pnpm install
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
openspec validate device-screen-wallpaper
```

The native smoke gate builds its own entry and uses hidden Electron windows,
real image decoding, the production preload and built renderer. It checks both
serials, fill modes, matching clock notifications, the strip key grid for five
built-in-like profiles (`main/test/strip-fixtures.ts`), light theme, reduced
motion and narrow layout. An optional absolute directory receives screenshots,
including `panel-<profile>.png` for each fixture. Replace the quoted placeholder
with your own absolute output directory:

```sh
pnpm --filter @open-quake/desktop exec electron-vite build --config src/main/media/smoke.config.ts
env -u ELECTRON_RUN_AS_NODE OPEN_QUAKE_MOCK_DEVICE=1 pnpm --filter @open-quake/desktop exec electron out/media-smoke/smoke.js "<absolute-screenshot-dir>"
```

The smoke test creates a temporary user-data directory and removes it afterward.
Unit fixtures isolate filesystem failures from native decoding. Device tests
exercise geometry properties, invalid schemas, interval conversion, midnight,
noon, one-second updates and clock disposal using Effect TestClock.

Real panel placement, USB transfers, firmware targets and resource acknowledgments
remain unverified. No fake transport or renderer result closes those gates.

The smoke also injects source-derived raw vendor touch frames into the mock bus
and asserts the real preload/IPC and mounted panel emit one key down and one up.
For parity lanes, set `OPEN_QUAKE_MOCK_DEVICE=1` and `TMPDIR` to the lane scratch
directory, and use `env -u ELECTRON_RUN_AS_NODE` for the Electron invocation.

## Wallpaper playlists and sound

The editor appends managed JPEG/PNG images and decodable MP4, MOV or WebM
videos, removes duplicates by content, and persists drag or move-button order.
Videos need finite metadata, at least two seconds, at most 8 MiB and at most
64 million pixels. Codec support follows the bundled Electron build. The hidden
metadata worker never plays and stays muted, with an eight-second deadline.
A 256-entry content-hash LRU retains video metadata without base64 payloads.
Import and save validation populate it; subsequent reads reuse it while still
verifying managed bytes and saved formats. Cold misses after restart or eviction
probe once. No native probe holds the controller semaphore, and delayed snapshot
results cannot overwrite a newer selection, revision or playback identity.

The existing media controller chooses the active item for both renderers and
wraps sequential playlists. A singleton video loops in place. Management
previews stay muted. Panel sound requests require current window identity,
serial and revision and a lease from the canonical AudioOutput owner. Speech,
capture and soundboard can preempt wallpaper, with no automatic sound resumption.
Hiding the panel revokes pending and active sound requests; hidden panels cannot
acquire a lease. This also covers lifecycle hide on disconnect or lock.
Mock-device mode keeps the panel globally muted even with Video Sound on.

For the native smoke's optional silent video check, supply a local silent fixture
through OPEN_QUAKE_SMOKE_VIDEO. The smoke saves wallpaper-playlist.png,
wallpaper-playlist-narrow.png and panel-vivid.png alongside the existing images.
All smoke artifacts belong in the lane's external scratch directory.
