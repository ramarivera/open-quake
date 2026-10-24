# Key editor, icon library and runtime

Implements `openspec/changes/key-library-parity`. Management opens **Keys** from the app navigation. The pages use `ui/Form.tsx`; the Management Center shell remains owned by its lane.

The profile manager, key editor and runtime share one ProfileRepository. A draft has a token and profile/page/key/revision target. Preview broadcasts affect drawing only. Runtime activation reads committed profiles, checks the original panel target and deduplicates held input. Save validates and atomically replaces the selected key, preserving unrelated unsupported imports. Revision conflicts and failed writes retain the pending draft. Selection changes, click-away, renderer navigation and disposal discard it. Icon reset follows the same draft path. The Delete shortcut checks input, textarea, select and contenteditable focus, correcting MGMT-249.

Clock appearance uses the existing ClockSettings conductor. Hour format uses the existing wallpaper controller, whose saved clock feeds both panel and editor. These settings auto-save independently of the key's draft. The editor never changes the built-in catalog, grid spans or knob configuration.

Title resolution shares the profile catalog and recovered strings for en/zh/de/es/fr/it/ja/ko. Explicit custom titles, including empty strings and English default words, win over translations. Primary and alternate custom origins are separate. New input has a weight limit of 20, with the audited CJK range counting twice. Nonempty input enables display, moves to top and clears B/I/U. Advanced controls expose the vendor's hidden style operations. `userModifiedStyle` records an explicit style edit so built-in tile presentation stays unchanged until a user selects a style. Style reset preserves text and translation origin.

`@mdi/svg` is a build-time dependency pinned to exactly **7.4.47**. Its 7,447 paths, names, tags and aliases become one lazy Vite catalog chunk. Renderer builds include the package's upstream notice as MDI-LICENSE.txt. An owned resizable 600×550 child window provides icon selection. Search waits 500 ms; zoom is 40–120 in steps of 8, initially 72. Each lazy page contains `10 * max(1, floor(window.innerWidth / (zoom + 12)))` icons. Loading progress covers repository, installed-app and catalog reads; search stays outside the body overlay. Inert source images are rasterized to a 170×170 PNG on selection. Installed application icons are extracted locally and cached for the registration lifetime. Extraction runs outside the live key request semaphore, then rechecks picker ownership before returning its result. macOS reads the declared bundle resource through plutil/sips, avoiding a native Electron icon-lookup crash while the GUI is locked. Unavailable nonempty numeric DK artwork uses semantic MDI fallbacks; intentionally empty icons stay blank; proprietary packs are not bundled. Imported local assets and packs live in `<userData>/key-library-v1.json`, written through a temporary file and atomic rename. Duplicate packs use content hashes. Removal scans committed profiles and the pending draft, including alternate and nested compatibility payloads.

Stream Deck packs use manifest.json, icons.json and icons/. Iconfont packs use iconfont.json and inert symbol text from iconfont.js, or a TTF rendered with Chromium FontFace/canvas in an isolated hidden window. Pack JavaScript never executes. ZIP parsing stays in memory, accepts stored/deflate entries, verifies CRC, rejects traversal, duplicate paths, links and encryption, and limits archive/expanded/entry bytes to 32/64/5 MiB with at most 10,000 entries. SVG uses an element allowlist and rejects scripts, entities, events and external references. Raster decoding checks dimensions. Fonts and audio use bounded inputs, timeouts and window cleanup.

The scoped KeyRuntime owns switch alternation, countdown fibers and sequential progress. A timer's duration is milliseconds; a second press cancels it. Countdown work survives profile navigation. Feedback is retained for returning to the profile, while inactive visual alerts are suppressed. Multi-actions validate every step before executing any, use 100 ms default gaps plus delay steps, and stop on second press or first failure. Supported sequence leaves are hotkey, website, text, open application and delay. Navigation wraps pages/profiles, clamps goToPage and uses the merged strip recognizer's slide directions without stealing sub-target scroll or knob overlays. Disconnect/reset disposes work and feedback.

IPC contracts are Schema-decoded across main/preload/renderer. Only the exact management URL in its top-level frame can edit. Only the exact owned icon child can import/remove icons; management cannot mutate icon storage directly. The child can read icons and return a token-bound PNG; it cannot edit profiles or activate keys. Closing or replacing its owner cancels selection, and delayed imports recheck authority before committing. Only the owned panel window can activate and navigate; other app documents can read. Authority is checked again after queued requests acquire the lock. Activation carries its original device/profile/page/revision snapshot. Native host effects use existing hardware keyboard and shell adapters. Text insertion serializes clipboard replacement, preserves supported formats and refuses unknown formats before mutation. Real media-key dispatch remains unavailable.

## Reproduce verification

Run the six repository gates, then the native consumer smokes from the repository root. `TMPDIR` and screenshot output must stay under the lane scratch directory. Every Electron launch must use mock mode and unset ELECTRON_RUN_AS_NODE.

```sh
pnpm biome check packages apps
pnpm typecheck
pnpm test -- --maxWorkers=2
pnpm build
env -u ELECTRON_RUN_AS_NODE OPEN_QUAKE_MOCK_DEVICE=1 pnpm --filter @open-quake/desktop test:bundle
openspec validate --all --strict

pnpm --filter @open-quake/desktop exec electron-vite build --config src/main/key-library/smoke.config.ts
env -u ELECTRON_RUN_AS_NODE OPEN_QUAKE_MOCK_DEVICE=1 TMPDIR=/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/key-library pnpm --filter @open-quake/desktop exec electron out/keys-smoke/smoke.js /Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/key-library

pnpm --filter @open-quake/desktop exec electron-vite build --config src/main/media/smoke.config.ts
env -u ELECTRON_RUN_AS_NODE OPEN_QUAKE_MOCK_DEVICE=1 TMPDIR=/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/key-library pnpm --filter @open-quake/desktop exec electron out/media-smoke/smoke.js /Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/key-library
```

The worker cap runs all suites while limiting contention with other parity lanes. Native smokes use real preload/IPC and renderer code, native image/font/audio decoding, injected synthetic touch and hidden windows. They dispose all runtimes/windows and remove temporary user data. See the OpenSpec verification artifact for row coverage, screenshots and explicit remaining limits. Real hardware and OS input/audio acceptance remain unverified.

Host keyboard output is unavailable in this desktop build. Hardware settings disable that choice and reject forged host-mode mutations; Device keyboard remains the supported shortcut/text route. The portable native font smoke searches installed host fonts or uses OPEN_QUAKE_SMOKE_FONT, and fails explicitly if no font is available.
