## Approach

Reuse existing Vitest, Effect 3.22.1, QuakeDevice, HardwareControls, node-hid and process-owned Pino diagnostics. A dedicated E2E file/config is excluded from ordinary test discovery. Native mode requires explicit opt-in, an exact canonical serial, no competing application process and an exclusive process lock. All settings use scratch preference storage; product data is untouched.

The same scenario consumer runs against the existing fake transport for regression tests. Native writes are limited to existing queries/keepalive and separately opted-in mic/luminance/knob-LED round trips. Capture all original values before mutations, register restoration before each write, and verify restoration even after failure. The background suite never flashes, saves firmware lighting, generates keyboard output, emits tones or changes screen power. Separately selected fixtures own approved keyboard and real audio tests.

Use fixed scenario IDs and report implemented, passed, failed, skipped and manual-only counts. Native percentage is native passes divided by the complete published inventory; fake passes contribute zero. These figures describe this bounded inventory, not whole-product feature or code coverage. Keep trace data and results under task scratch, omit device serial/path and arbitrary error strings from reports.

Build on the SSD worktree with outputs under owned scratch. Existing hidden UI smoke runs independently of native HID. Same-device focus/input/audio phases require the applicable readiness handshake.


## Supplemental automation

After the reviewed baseline lands, add an extended native consumer with a separate fixed check inventory. It uses the production shared-handle LightingService, exact qualified firmware/protocol, and queries every restored original lighting value. Changes to brightness, effect speed and color stay in RAM; save command 9 remains forbidden. Capture all originals before writes and attempt every restoration after failures. Stress checks serialize through the production connection and exercise real software reconnects without calling them physical hot-plug.

The explicitly selected Electron audio fixture uses the production capture driver without synthetic-device flags. It checks USB input selection, PCM framing, pause/resume, stop and worker cleanup. Samples remain in memory; retained results contain only bounded signal metrics. No provider keys or paid calls are required. Failure, denied microphone permission or unavailable native capability is retained explicitly, not reported as a pass.


## Concrete follow-up for installed protocol 12

Native evidence identifies QUAKE:3:1.0.19, protocol 12. Existing production LightingService correctly rejects the protocol 10 legacy profile. Readbacks and exact restoration qualify only V3 channel 3/value 3 effect speed. Brightness and color are not yet byte-for-byte mappings. A production fix would add `v3` to LightingCapabilities.transport, expose only the effectSpeed descriptor, map it to QMK prefix [3,3] on the shared owner, and leave save/brightness/color/effect unavailable. The repository requires explicit approval for this capability schema change. This proposal is ready for review; test automation continues independently.
