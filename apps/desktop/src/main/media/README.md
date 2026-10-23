# Desktop wallpaper media

Implements `openspec/changes/device-screen-wallpaper` tasks 1.1–1.5.
The main process owns selected files, decoding, persistence and the host clock.
The panel and management preview share one SVG renderer on a logical 1920×480
canvas. The `dkDesktopClock` registry entry has exactly one `hourFormat` action,
default `24h`. Main broadcasts one local-time snapshot per second to both views.
The clock stream stops when all windows close, restarts with a new window, and
is interrupted on quit. No firmware clock event is sent.

## Stored schema

The root is `<userData>/wallpaper-v1/`. Settings use
`settings/<sha256(serial)>.json`, with the last valid revision in
`settings/<sha256(serial)>.backup.json`. A save validates before IO, writes the
previous validated settings to the backup, then atomically renames the new
settings file into place. A failed write retains the current revision. An
invalid or missing primary can load the validated backup. Updates require the
current revision, so concurrent saves cannot silently overwrite one another.

The version 1 envelope contains `serial`, nonnegative `revision`, `settings`
and `clock`. The device display Schemas define these fields:

- `isTransparent`: false for this release.
- `bgFillMode`: `contain`, `cover` or `center`, default `cover`.
- `gapInterval` and `gapIntervalUnit`: integer seconds 3–86400 with unit 0,
  or minutes 1–1440 with unit 1. Defaults are 5 and 0.
- `playMode`: `sequential` or `random`, default `sequential`. Static images
  do not schedule playlist switches.
- `displayMediaList`: zero or one image for this release. Each item contains
  nonempty `name`, `type: image`, `filePath: media:<sha256>`, `duration` in
  milliseconds matching the interval, and decoded `format: image/png|image/jpeg`.
- `clock`: `type: dkDesktopClock` and exactly one
  `{type: hourFormat, value: 24h|12h}` action.

The main-process file picker supplies the source path. A legacy file URL can
be normalized by `importLocal`; its result flags that conversion for display.
The adapter checks PNG/JPEG signatures and requires Electron `nativeImage` to
decode the content. Extensions and caller-supplied MIME types are insufficient.
Imports are limited to 8 MiB and 64 million decoded pixels. This is a desktop
limit and says nothing about device resource limits.

Accepted bytes are copied into `assets/<sha256(bytes)>`; the renderer receives
a validated image data URL, never a filesystem path. Reads verify the content
hash. Deleting the original selected file does not remove its managed copy.
Missing, modified or undecodable managed assets retain their saved selection
and show the neutral background with instructions to select another image.
Imports never change DK-Suite storage or copy its bundled artwork.

## Status and integration

`desktop-preview` is the initial serial for a clearly labelled preview session.
Management can select an actual serial explicitly. Device discovery and profile
selection can call the same controller later; they do not infer a serial here.
The active serial selection is session-local; each serial's settings persist.

Decoded IPC commands are read/select/import/configure/clear/restore. Only the
app's renderer document and top-level frame may call the handler. The panel
can read; management can mutate. Closing a renderer removes both listeners.
Snapshots contain a versioned saved revision, decoded asset state and host
clock. Images use the existing theme tokens without decorative animation.

`asset: ready` means the desktop decoder accepted the image. Device delivery
is always `unverified` in this lane. Saving and previewing never send HID bytes
or assert hardware application. Tasks 2.x still own resource transfer state,
L1 capability agreement and the separate keyed-icon/full-panel hardware gates.

The desktop adds the existing catalog dependency `effect` 3.22.1. It imports
the display-only device modules directly so Electron builds bundle workspace
TypeScript and renderer bundles never import HID adapters. No image dependency
was added. The main and preload integrations each use one side-effect import.

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
serials, fill modes, matching clock notifications, light theme, reduced motion
and narrow layout. An optional absolute directory receives screenshots:

```sh
pnpm --filter @open-quake/desktop exec electron-vite build --config src/main/media/smoke.config.ts
env -u ELECTRON_RUN_AS_NODE pnpm --filter @open-quake/desktop exec electron out/media-smoke/smoke.js /tmp/open-quake-w6-visuals
```

The smoke test creates a temporary user-data directory and removes it afterward.
Unit fixtures isolate filesystem failures from native decoding. Device tests
exercise geometry properties, invalid schemas, interval conversion, midnight,
noon, one-second updates and clock disposal using Effect TestClock.

Real panel placement, USB transfers, firmware targets and resource acknowledgments
remain unverified. No fake transport or renderer result closes those gates.
