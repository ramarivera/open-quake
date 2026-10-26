# Monitoring software verification, 2026-10-26

Software implementation tasks 1.1–3.1 are covered. Aggregate acceptance task 3.2
and Beads epic open-quake-s8d remain open for interactive target-platform and
physical panel evidence. No DK-Suite, real HID, microphone or provider was used.

## Scenario coverage

| Contract | Source and observation |
| --- | --- |
| Identity / unsupported collector | Schema round-trips, native collector tests and read-only macOS smoke. CPU starts unavailable until a delta exists; GPU and Bluetooth report unsupported. |
| Staleness / slow collector | Existing MonitorService fake-clock tests retain the last valid sample after three intervals and prevent overlapping requests. Independent workers keep other metrics usable. |
| Rate / selection bounds | Property tests validate 0.2–10 Hz, unique known IDs and reversible overlay. Invalid configuration/store tests preserve the prior revision. Legacy records decode with defaults. |
| Foreground coalescing | Actual foreground-probe adapter test starts two consumers against one pending native read. Stop aborts it; both receive typed failure and private causes don't serialize. |
| Disable / shutdown | MonitoringService fake-clock tests interrupt pending metric/foreground work and reject late results. Scoped teardown releases both workers. A regression exposed inherited uninterruptibility; workers now explicitly run interruptibly before forkIn. |
| Permission / query failure | Typed permission denial and collection failure leave memory metrics running, then the foreground stream recovers. A five-second TestClock deadline stops a stuck query without overlap. |
| Durable configuration | MonitorStore interrupted-save regression proves an accepted atomic disk write and in-memory revision settle together. Existing conflict and persistence failures preserve the last valid record. |
| Transport / authority | Actual encoded RPC server, preload and typed client round-trip snapshots. Unknown calls, forged payloads, tracing authority and malformed responses are rejected. Unsubscribe drops late delivery. |
| Enter / leave override | Hidden Electron drives the real Save controls into CPU-only mode. Panel shows six modules Off; management matches. Exiting restores the saved normal selection. |
| Edit normal configuration | Changing the normal rate to 2 Hz while the override runs leaves it at 1 Hz. Exiting switches to the latest saved 2 Hz rate. |
| Shared failure snapshot | Injected network failure and current CPU sample are identical in actual management/panel messages at a shared sampledAt. Recovery reaches management; full foreground state is refused to panel and thumbnail. |
| Consumer lifecycle | Trusted management starts collection, URL-spoofed thumbnails can't subscribe, save broadcasts don't leak, master disable stops metrics, and detaching the last metric consumer stops collection. |

The existing scoped foreground probe is reused; it doesn't collect window titles
or retain history. Management derives an app display name from transient identity.
Panel gets metric snapshots only. The live foreground portion of this smoke is
mock absence, not native foreground identity proof.

## Actual application and checks

The committed monitor smoke builds the production renderer/preload and registers
the real monitor owner. Electron windows stay hidden and use isolated userData.
The native adapter sampling step reads system metrics without touching a device.
It passes the existing media, video, touch and five-style panel checks as well as
the new saved monitoring control paths.

Opus 5.5 designed the controls and narrow correction. Final captures cover normal,
override, foreground mock and disabled states, each at 1180, 820 and 390px, with
preview, Live status and control views. All 36 captures pass an assertion against
horizontal overflow in inner scroll containers. The 390 preview now has three
style columns and wrapped background buttons. The 820 preview and narrow live
and override views were also inspected directly. These are Graphite renders.

Final focused checks pass: 9 edge monitoring tests, 63 desktop monitor/foreground
tests, desktop/edge/client typechecks, production build, Biome with 14 existing
warnings and strict OpenSpec validation. The broader implementation run passed
1,527 desktop tests and 494 edge tests with three external-container skips,
using external TMPDIR. Subsequent transport hardening, worker interruption and
narrow CSS changes were checked by the focused runs and actual app smoke.

After merging current main's reviewed native-media change, 82 focused desktop
monitor/foreground/native-media/diagnostics tests pass, with one optional native
test skipped. Desktop typecheck, production build and both default/mock bundle
smokes pass. The merge preserved the monitoring diff without conflicts. This
disposable worktree lacked generated Husky shims; `pnpm prepare` restored them,
and the commit-message/post-commit hooks were checked before normal push gates.

Local-only artifacts, never committed:
`/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-finish/monitoring-state/`.
The final smoke output is under `final-smoke/`; tests/build logs are under
`tests/`; Opus decisions and patches are under `design/`.

## PR60 review corrections

All three functional review findings reproduced in focused regressions before
implementation. Normal and override metric lists now require at least one entry;
rejected saves don't write or increment the revision. MonitorPanel clears values
for uncollected modules at the shared rendering boundary, including sample-backed
strip/profile previews and all five styles. Foreground names select the nearest
case-insensitive macOS app bundle, while Windows executable names remain intact.

The smoke now accepts an explicit artifact directory and creates it, matching the
weather/media harness. It no longer requires a machine-specific volume path.
The first attempted rerun used a missing output directory and stopped before
testing; its owned Electron process was terminated. The corrected harness then
passed from a newly created directory, including all 36 responsive captures and
horizontal-overflow checks. Focused checks pass: 34 desktop tests, 9 edge tests,
both package typechecks, production build, scoped Biome and strict OpenSpec.
Artifacts are under `review/after-created/` in the external monitoring scratch.
These checks use hidden mock windows and don't establish physical acceptance.

A later shutdown regression confirms configuration after scope closure succeeds
as a no-op without collectors or state changes. It failed before the fix with
an inaccurate invalid-settings error. Valid configuration no longer reports a
validation failure solely because shutdown won the lifecycle lock.

## Remaining acceptance

- Physical QUAKE display placement, orientation, touch direction and readability.
- Interactive native foreground identity and two-app transitions on target hosts,
  including permission denial and helper teardown. Windows session-0 absence
  evidence from the profiles change doesn't establish interactive identity.
- Windows/Linux metric support remains CPU/memory only; GPU, Bluetooth and other
  unsupported modules remain explicit. No collector is implied by a picker.
- The current strip retains seven modules; Bluetooth has no separate panel tile.

Task 3.2 stays unchecked. This evidence doesn't finish the broader parity goal.
