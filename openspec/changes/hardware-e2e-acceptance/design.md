## Approach

Reuse existing Vitest, Effect 3.22.1, QuakeDevice, HardwareControls, node-hid and process-owned Pino diagnostics. A dedicated E2E file/config is excluded from ordinary test discovery. Native mode requires explicit opt-in, an exact canonical serial, no competing application process and an exclusive process lock. All settings use scratch preference storage; product data is untouched.

The same scenario consumer runs against the existing fake transport for regression tests. Native writes are limited to existing queries/keepalive and separately opted-in mic/luminance/knob-LED round trips. Capture all original values before mutations, register restoration before each write, and verify restoration even after failure. Never flash, save firmware lighting, generate keyboard output, emit tones or change screen power in this suite.

Use fixed scenario IDs and report implemented, passed, failed, skipped and manual-only counts. Native percentage is native passes divided by the complete published inventory; fake passes contribute zero. These figures describe this bounded inventory, not whole-product feature or code coverage. Keep trace data and results under task scratch, omit device serial/path and arbitrary error strings from reports.

Build on the SSD worktree with outputs under owned scratch. Existing hidden UI smoke runs independently of native HID. Same-device focus/input/audio phases require the applicable readiness handshake.
