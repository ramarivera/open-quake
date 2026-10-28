# Desktop knob composition

Main consumes `QuakeEvent` rotation and firmware press classifications through
`registerKnobRuntime`. Renderer commands cannot inject physical events. Only the
actual panel window's top-level app document may mutate state; management can
read. Renderer validates replies and snapshots without native causes.
Shutdown interrupts streams, timers, pending writes and owned voice work.

Production shares the profile manager's runtime and serialized repository for
`profiles-v1.json`. In the application root, `knobProfileBinding` delegates to
`registerProfiles(...).select`. That method uses the manager's visibility,
anchor and connected-device delivery rules, then reads the committed envelope.
It is the selection owner. The binding's default `ProfileService.selectProfile`
callback remains for isolated consumers. Promise failures retain the underlying
catalog error rather than only Effect's FiberFailure wrapper.

The parent composition root supplies these `DesktopKnobBindings`:

```ts
{
  deviceId: () => activeSerial ?? "desktop-preview",
  locale: () => knobLocale,
  profiles: knobProfileBinding(profiles.runtime, profiles.select),
  thumbnail: profiles.thumbnail,
  hardware: () => bus?.hardware?.(),
  voice: voice.knobVoice,
}
```

`activeSerial` comes from the device connection's `info.serialNumber`. Set it
before profile enrollment and connected-event initialization, and clear it when
that connection is released. Do not derive it from a profile's display name or
create another profile service. Context reads use that device's committed
profile and page. An isolated fallback writes only that device's selection;
late selections for a replaced device fail with the stale-session catalog code.
Call `knob.refresh()` after committed profile changes. Global application locale
is authoritative. The root subscribes through
`localeRegistration.onLocaleChanged(synchronizeKnobLocale)` before requesting
`localeRegistration.locale()`, updates `knobLocale`, and refreshes on changes.
Revision checks prevent a late startup read from overwriting a newer saved
selection. Dispose this subscription on shutdown. These methods use the existing
canonical SettingsService runtime and never construct another settings store.
`profiles.currentLocale()` remains a manager-local convenience for isolated
consumers. It defaults to en until a non-preview manager read and is not the
production root's startup authority. A
content-and-locale fingerprint invalidates even an inactive profile's thumbnail
or an edit that retains the same revision. Identical publications preserve the
current selector and ready cache. Production root wiring is verified separately from physical interaction.

Native macOS volume supports player mode and focused volume tiles. Registration
owns one sequential observer, polling at one-second intervals only while player
volume is armed and connected. Each read is bounded to three seconds and 4 KiB
of process output, and interruption kills its child. Observations never write
volume. They dispatch the existing `ObservedVolume` command, preserve the
500 ms desired-value guard, and discard reads crossing a local volume change,
session replacement, disarm or disconnect. Disposal interrupts the observer.
Other platforms need a volume binding. Tests use injected reads and writes;
no actual OS volume read or write was run for this backend lane.

Focused screen luminance uses the current hardware session's `stepBrightness`,
which sends typed `Luminance` commands in 26/255 steps with minimum 25. Monitor
brightness still needs a qualified binding. Focused directional hotkeys reload
the committed visible profile and validate both actions with HotkeyConfig before
sending action 0 for decrease or action 1 for increase through
`hardwareKeyboardAdapter`. Device/profile/page/revision/content and replaced
hardware checks reject stale work. The existing keyboard adapter honors input
mode and releases the chord; host mode without a qualified host adapter fails
instead of injecting globally. The named `DesktopKnob.focusedHotkey` span retains
private original causes in the shared diagnostics trace without recording chord
text. Voice delegates to the supplied owner; source composition does not prove live microphone, speech
or physical hold/release acceptance. Unavailable actions retain catalog notices
and hardware error-tone behavior. Physical focus/volume acquisition outside the
picker remains uncomposed.

Profile manager captures and knob reads now share
`<userData>/profiles/thumbnails/<content-and-locale-sha256>.png`. The existing
thumbnail key includes the encoded translated profile, locale and rendering
version. The old `profile-thumbnails/<sha256(id)>.png` directory is unused.
The canonical store limits reads to 1 MB, validates PNG signatures and native
decoding, and publishes private temporary files through atomic rename. Failed
replacements preserve the prior valid capture. Content-addressed invalidation
prevents old revisions/locales from being read, without deleting unrelated files.

The model uses one compact FunctionWheel presentation for every profile turn,
whether thumbnails are ready or still loading. Missing images use the wheel's
text labels. Thumbnail warming is asynchronous and never changes the selector
or replays a detent. The knob asks the same profile manager for a hidden,
serialized, abortable capture when its canonical cache is absent. Capture is
bounded to ten seconds; no second manager runtime is created. Warming rereads
only canonical files and rechecks current profile content and locale before
publishing.
Errors retain their original causes privately and diagnostics serialize only
catalog/source identities. No external thumbnail URL is accepted.

Renderer overlays live entirely in `strip/overlays/knob/` and mount inside the
existing strip canvas. `KnobDial` and `VolumeCapsule` are exported for the strip
grid owner. Pass its actual tile dimensions and read-only state when composing.
`KnobPanelLayer` mounts in StripPanel and uses the actual strip layout for tile
bounds. Tapping an unsupported grid tile clears focus. Profile feedback uses
only the translucent, compact FunctionWheel, which leaves tile labels visible.
Physical focus/volume acquisition remains owning-lane work.

## Knob state machine

The model serializes every device event and owns all deadlines with Effect
Clock. Its idle rotation priority is focused tile, active player volume, then
profile selection. Every profile detent advances the same ordered profile list
and resets a 200 ms settle deadline. At that deadline the current profile is
persisted once. Selecting the already active profile closes without a write.
The same FunctionWheel feedback appears with warm and cold thumbnail caches and
hides 1200 ms after a committed selection or external profile change. Its translucent
background and 320 px height keep the strip's tile labels readable.

Firmware press codes stay distinct. Code 1 confirms a pending profile selection
or interrupts voice when no selection is pending. Code 2 dismisses pending
selection and selects Colorful Screen. Code 5 dismisses pending selection and
starts push-to-talk; code 255 releases that same hold generation. Profile
rotation commits after 200 ms without another detent; a press during that
interval confirms immediately. Press behavior never depends on whether a
thumbnail arrived first. Physical
short, double and hold classes come from firmware; the host adds no gesture
classification timer. These decisions preserve the recovered firmware
classifications documented in `openspec/changes/knob-model-parity/design.md`.

DOM pointer and touch fallback is enabled only while the vendor device
connection is unavailable. A connected device owns the panel input path, so a
late native report cannot race a vertically mirrored macOS pointer event into a
second tile action. Disconnect returns ownership to the DOM fallback.

## Native verification

Run from the worktree root. Both Electron windows stay hidden. No HID adapter
is imported by this smoke entry. Use an absolute lane directory for artifacts:

```sh
pnpm build
pnpm --filter @open-quake/desktop exec electron-vite build --config src/main/knob/smoke.config.ts
env -u ELECTRON_RUN_AS_NODE OPEN_QUAKE_MOCK_DEVICE=1 TMPDIR=/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/knob-model/tmp pnpm --filter @open-quake/desktop exec electron out/knob-smoke/smoke.js /Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/knob-model
```

This drives the production DeviceBus consumer, domain, IPC, preload and renderer
with mock action/voice/volume ports. It verifies native pointer paging/dismissal,
rotation=90 pointer and physical-touch paging/card selection without grid
leakage, exclusive selector rendering, physical-failure warning publication,
panel identity permissions, press arbitration and focus/volume dispatch, and
checks the canonical thumbnail writer/reader against valid and truncated PNGs using
Electron decoding. Captures include ring, picker, page 2, volume and tile dial.
It does not qualify QUAKE direction, physical touch coordinates, monitor/panel
brightness, OS hotkeys, live voice or actual volume drivers.

The required wallpaper regression smoke remains documented in
`../media/README.md`; run it with the same mock environment and lane TMPDIR.

Source evidence and residual risks are in
`openspec/changes/knob-model-parity/design.md`. The 0.4.52 script supplies the
missing FunctionWheel script in the 0.4.95 map. Its client template removes the
old halo layer; the strip retains the cyan arc and directional glow. The 200 ms
angular nudge changes the client label's horizontal arc position while its
vertical offsets and side rotations stay fixed.

## Backend lane verification

Focused tests cover the production manager capture entry point with mocked
Electron operations, canonical filesystem IO, independent device selections,
cause retention, correlated diagnostic spans, observation timing and cleanup.
A windowless Electron fixture exercised the actual native decoder with the
canonical writer and knob reader. The current backend lane did not rerun the
full renderer smoke described above and does not qualify real hardware, native
volume behavior, focused monitor/hotkey actions or live voice. The aggregate
OpenSpec task 5.1 and bead `open-quake-lih.4.2` remain open.

## Focused host brightness

The default brightness binding reads the canonical committed visible key before native IO and again before mutation. Unsupported imported keys cannot execute. Read, five-percentage-point step, clamp, write and readback serialize under one owner. Failed reads never produce guessed values or writes, and unchanged readback is a failure. QUAKE luminance remains the independent device-screen control.

Native targets are the main macOS DisplayServices display, exactly one active Windows WMI backlight, or exactly one Linux sysfs backlight. Targets are pinned through mutation. Windows brightness methods need not return a status field, so success requires the controller's independent readback. Linux reads have bounded numeric buffers and reject changed target identity or maximum. Subprocesses have a five-second hard termination deadline, bounded output and interruption cleanup. No global brightness shortcut, elevation or external helper is used. A mock device disables native brightness unless a test explicitly injects an adapter.

Named DesktopKnob.focusedBrightness and DesktopBrightness spans preserve catalog failures and private native causes through normal knob warning feedback. Persisted diagnostics contain source identities and correlation IDs, not display identifiers, paths or raw native output.

Acceptance on 2026-10-25 verified actual macOS built-in brightness write/readback/restoration on ramiro-macbook and Windows WMI write/readback/restoration on zeph. The Mac mini main display reports unsupported. Synthetic filesystem tests cover Linux sysfs scaling and identity failures; physical Linux backlight writes remain unverified. The hidden production-root mock test confirms panel focus plus both device-event detents and failed-write notice without changing host brightness. Physical knob touch and receipt remain separate acceptance.
