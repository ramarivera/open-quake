# Design

## Context

DK-Suite drives the QUAKE strip as an extended OS display and renders the desktop clock as a live 1920×480 web stage (AUDIT_WIDGETS §1). open-quake does the same: the panel window covers the strip and React renders the clock. No HID command is involved.

Path roots (local-only, read-only research inputs, never committed):

- `V` = `~/dev/dark-encyclopedia/dk-suite-introspeccion/v0.4.95`
- `RS` = `V/recovered_sources/src`

Recovered sources this design copies from:

- `RS/views/Components/dkDesktopClock.vue`: stage, date rail, theme nav, tint table, tick scheduling.
- `RS/views/Components/DkFlipClock.vue`: flip geometry, two-phase flip, AM/PM pill.
- `RS/views/Components/DkClockBackground.vue`: L0 media, 5 s fallback, generation token, L1 scrim.
- `RS/shared/clockContract.js`: theme ids, slot shape, normalisation/migration, `resolveBackground`.
- `RS/shared/clockThemePatch.js`: narrow theme patch and its failure reasons.
- `RS/views/Components/UnitControl.vue:1859-1889`: `clock-style:set-theme` call and rollback.
- `V/locales/locale-*.json`: `dkDesktopClockLang.*` and `settings.clock*` strings in 8 languages.
- `V/app-resources/clock-bg/theme-*.jpg` + `README.md`: DK's built-in art (reference only, see decision 2).

## Goals / Non-Goals

Goals: the clock renders like DK-Suite 0.4.95 on the strip, pixel for pixel in layout, type and material. It keeps the behaviour DK-Suite gets right and fixes what it gets wrong (frozen PC preview, file paths in URLs).

Non-goals: weather and now-playing cards (`open-quake-lih.7`); the grid itself (`open-quake-lih.2`, which leaves this lane only the `dkDesktopClock` registry entry); the profile catalog and editor revert model (`open-quake-lih.8`, `open-quake-lih.9`); touch frame decoding (`open-quake-lih.3`).

## Decisions

1. **Geometry, type and material are copied verbatim.** Stage 1920×480, `padding: 0 64px`, flex row centred. Date rail 240×300 at x 80. Flip block of four 160×300 cards with 14 px gaps and a colon column, centred by auto margins in the space between rail and right slot. Right slot 564 wide with `margin-right: 16`. Glass tokens, tint table, scrim gradients, font stack and every size/weight/letter-spacing come from the recovered CSS. The right slot collapses to zero width when no card is present, exactly as DK's flex layout does when weather and music are off. In that case the flip block centres at x ≈ 1080, not 798.

2. **Built-in art is our own.** DK's five JPEGs ship inside a proprietary app bundle with no licence grant. Its README says DecoKee generated them with OpenAI ImageGen. Licensing is unclear, so open-quake does not copy them. It ships its own equivalents: deterministic SVG scenes built by pure TypeScript (`art/`), seeded so they are identical on every run, at 1920×480, each following DK's composition notes:
   - season: misty alpine valley at sunrise, blue-grey firs, peach sky.
   - cyber: rainy neon megacity at night, violet and blue.
   - anime: bright summer sky with cumulus over green hills.
   - tactical: night industrial compound with a searchlight.
   - aurora: green and violet aurora over dark mountains.
   DK's files are cited by path only. A user who wants DK's pictures can pick them as the theme's custom image.

3. **The profile repository owns clock configuration.** Each profile/page/key carries `hourFormat`, `clockStyle` and `showSeconds` actions. Clock IPC carries an explicit target, and writes use the repository transaction with a profile revision check. The first load migrates the legacy clock record and wallpaper formats before publication, retaining both originals. Custom profile values win; missing or built-in-default actions inherit legacy values. Profile-selected serials are ordered lexically, then desktop-preview and remaining saved serials in lexical order. The same atomic envelope records `clockConfigVersion: 1`, so repeat loads and newly created profiles never reimport old settings. A failed write leaves migration retryable.

4. **Custom media never exposes paths.** The slot stores `{ kind, path }` as DK does, but only main reads `path`. The renderer receives `{ kind, name, available }` and a URL `oq-clock-media://theme/<themeId>?r=<revision>&t=<encoded profile/page/key>`. The protocol handler resolves the theme's persisted slot, rejects anything else with 404, and streams the file through `net.fetch` with the request's `Range` header so video seeking works. This replaces DK's `dkbg://bg/media.<ext>?p=<abs path>` plus allow-list (WIDGETS-034).

5. **Media selection mirrors DK's validation.** Management asks main to choose a file for a theme. Main shows the dialog filtered to `jpg jpeg png gif webp bmp mp4 webm mov mkv`, checks that the file exists and its extension maps to a kind, and stages it as a pending candidate. Images commit at once. For videos, management probes duration through the candidate URL (6 s timeout) and commits only when the video is at least 2 s long. Otherwise it shows "Video duration too short, should be longer than 2 seconds." Cancel writes nothing (WIDGETS-059).

6. **Ticking happens in each view, aligned to wall-clock boundaries.** A view schedules its next update at the next minute boundary (or the next second when seconds are shown), re-reads `Date.now()` there, and re-arms. It resynchronises immediately on `visibilitychange` to visible. DK ticks only on the device; open-quake's management preview ticks too (WIDGETS-029, gap 1 "beat DK" note). Labels are always derived from the current instant and never accumulated, so sleep, DST and timezone changes are picked up at the next tick.

7. **The flip is a small sequencer, not CSS alone.** When minute-ones changes, the upper flap keeps the old digit and runs `flipOn` (0→-92°, 380 ms, `cubic-bezier(.45,.05,.55,.95)`). Then it shows the new digit and runs `flipDown` (92°→0, 380 ms, strong glass) and returns to idle. A change during a flip restarts from the previous value, as DK does. Hours and minute-tens snap. Reduced motion switches immediately. "Reduced" means the OS preference or the app's appearance setting `motion: reduce`, which already drives `data-motion` on the root.

8. **The theme switch is optimistic with rollback.** ◀/▶ cycles `season, cyber, anime, tactical, aurora` with wrap; from `none` it starts at season. The tile shows the preview immediately and calls `onThemeSelect(themeId)`. A result of `{ ok: false, reason }` or a rejected promise reverts the preview. A new persisted `theme` prop clears it. Reasons are DK's: `bad-config | invalid-keycode | invalid-theme | cell-missing | cell-not-clock | no-target | write-failed` (WIDGETS-038). Unlike DK, a newer selection is never rolled back by the failure of an older one.

9. **Touch uses DK's sub-touch contract.** Theme buttons carry `data-quake-sub-touch="clock-theme-prev|next"` and `data-support-quake-move="false"`. They handle `quake-sub-touch-start` / `quake-sub-touch-end` CustomEvents with `detail.isEffective`, as well as pointer and click. The action fires exactly once, on click or on an effective sub-touch end. The touch lane (`open-quake-lih.3`) dispatches those events from `0xFF73/0x71` frames.

10. **Seconds are an option (approved decision 6).** Default off, so the strip looks like DK-Suite. When on, a glass seconds pill joins the AM/PM pill in a column 18 px right of the minutes. It uses the AM/PM pill's material at 40 px weight 200, tabular figures, with no animation, so the minute flip stays the only moving part. Ticks move to one per second while it is shown.

11. **Cards are slots.** `ClockTile` accepts optional `weather` and `nowPlaying` React nodes and exports the `ClockWeatherCardProps` / `ClockNowPlayingCardProps` data contracts that lih.7's cards implement. They are taken from DK's card inputs. An absent card renders nothing: no placeholder data and no reserved space.

12. **Errors are module-local catalog leaves**, matching `display-errors.ts`: `QUAKE.CLOCK.CONFIG_INVALID`, `QUAKE.CLOCK.PERSISTENCE_FAILED`, `QUAKE.CLOCK.MEDIA_UNUSABLE` ("File missing or unusable; fell back to built-in") and `QUAKE.CLOCK.MEDIA_TOO_SHORT`. The IPC edge maps them to typed replies by tag. Raw causes stay on the instance, non-enumerable.

13. **Strings come from DK's locales.** Weekdays, AM/PM, theme names, ◀/▶ labels and the settings strings are copied verbatim for en, zh, ja, ko, de, fr, es and it. The locale comes from `navigator.language`, normalised to those eight with English fallback. Date text follows DK: zh/ja/ko use `toLocaleDateString(loc, { month: 'long', day: 'numeric' })`; other locales use the upper-cased short month plus the day.

## Data model

```ts
type ThemeId = "season" | "cyber" | "anime" | "tactical" | "aurora";
type ClockStyle = {
  background: { mode: "none" | "theme"; themeId: ThemeId;
                themes: Partial<Record<ThemeId, { kind: "image" | "video"; path: string }>> };
  musicEnabled: boolean;            // kept for DK import parity; the card is lih.7
};
type ClockTileProps = {
  widthPx: number; heightPx: number; now: Date; theme: string; // ThemeId | "none"
  hourFormat?: "24h" | "12h"; showSeconds?: boolean; locale?: string;
  reducedMotion?: boolean;
  media?: Partial<Record<ThemeId, { kind: "image" | "video"; url: string }>>;
  onThemeSelect?: (themeId: ThemeId) => Promise<ClockThemeResult>;
  weather?: ReactNode; nowPlaying?: ReactNode;
};
```

`normalizeClockStyle` is total and accepts both the v0.4 shape and the v0.3 shape. v0.3 migrates as DK does: `builtin` maps to a theme, image or video becomes the season slot, and garbage falls back to `theme/season`, music off.

## Risks / Trade-offs

- `backdrop-filter` over a full-strip image costs GPU time. DK ships the same 26 px blur. Only the flipping card animates, and only for 760 ms a minute.
- Procedural art will not match DK's painterly AI images stroke for stroke. Composition, palette and mood follow DK's notes; users can still choose any image.
- Strip tiles normally read everything from the host context. The clock reads the selected profile key and runs its own boundary-aligned ticker, seeded from the host clock, so the flip lands on the minute rather than up to a second late on main's one-second stream.

## Verification

Unit tests cover the contract (normalisation, migration, resolve, patch reasons, cycle order), labels (12h/24h, midnight/noon, locale dates, weekday tables), the boundary scheduler and the flip sequencer under fake timers (380 + 380 ms, restart, reduced motion, disposal). They also cover the theme-preview controller (optimistic select, rollback on `ok:false` and on rejection, no stale rollback, clear on persisted change), static rendering of the tile at 1920×480 and scaled, the store (patch, revision, atomic write failure, invalid file) and media URL resolution. The native Electron smoke renders all five themes, None, seconds and 12h at 1920×480 with screenshots, exercises the panel ◀/▶ save path and a forced save failure, and checks the 5 s fallback with a missing custom file. Hardware (the strip itself, touch on the buttons) stays unverified until the lead runs it on the QUAKE.


## PR #25 review round 1

Main now includes strip-touch from PR #20 and hardware controls from PR #22; both the Controls page and the Screen page clock remain registered. The existing `dkDesktopClock` sub-target flag and the clock buttons' `data-quake-sub-touch` attributes connect directly through the merged registry. The clock native smoke sends synthetic raw touch frames through the mock bus, preload and mounted registry and checks one revision per button tap. Physical touch remains lead-owned.

Settings decode with excess-property preservation at every level before a narrow mutation. Legacy backgrounds migrate into their season slot before theme changes. A successful rename commits a save even if temporary-file cleanup fails, and a failed read projects recovered defaults.

The clock protocol uses Electron webRequest's browser-owned requesting frame identity to authorize subresources from the exact app document. Top-level protocol navigation and media from unrelated documents are denied. Video commits ignore management's duration hint and use an isolated hidden main-owned decoder window without a preload or app bridge, with a six-second timeout. The shared video probe handles WebM without a finite metadata duration by seeking to the end. Native checks cover valid media access followed by denial after navigation and rejection of a forged duration for a real short WebM.

Theme cycling from None intentionally matches `recovered_sources/src/views/Components/dkDesktopClock.vue:329-333`: season is the base, so next chooses cyber and previous chooses aurora. The review suggestion to select season on next was declined against that source.
