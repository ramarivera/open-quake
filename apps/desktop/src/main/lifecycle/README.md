# Device lifecycle

`device-lifecycle` owns the display pairing transaction, panel visibility,
connection diagnostics and host display prompts. `QuakeDevice` remains the only
HID owner. Screen power is opcode 1, command 4, value 0 or 1, encoded through the
existing protocol adapter. No second handle is opened for discovery.

Discovery subscribes before the off write, keeps topology snapshots, waits for a
unique disappearing candidate, restores power, and waits for its return. It
coalesces concurrent transactions and restores power on timeout or interruption.
Without a display candidate it returns unavailable without changing screen power.
Topology events received during a check are retained; unresolved pairing retries
a changed candidate set after power is restored. Its own off/on events restoring
the same candidate set do not trigger another transaction. The 30-second timeout
leaves ambiguous displays unbound. Physical dimensions are
rounded `size * scaleFactor`; source comparison is strictly less than 10 pixels
from 1920x480 or 480x1920. This corrects the audit's inclusive-looking ±10 wording.

The panel parks immediately on display loss. USB loss retains the same window
through 3000 ms of grace, releases its binding and suspension lease at 3000 ms,
and destroys the window at 5000 ms. Reconnect cancels both deadlines.
Development can show the primary fallback; packaged release keeps it hidden.
Unlock schedules recovery after 2500 ms. Resume while locked remains deferred.
Wake recovery requests a scoped HID reopen; finalizers finish before a new open.

Native calls are isolated in `native-display.ts`. On macOS the app probes
`CGDisplayIsInMirrorSet` using `/usr/bin/osascript -l JavaScript`. An explicit
consent dialog describes a CoreGraphics transaction using
`CGBeginDisplayConfiguration`, `CGConfigureDisplayMirrorOfDisplay`,
`CGConfigureDisplayOrigin`, and `CGCompleteDisplayConfiguration`. It moves the
strip to the far right and demotes it when primary. Other display origins retain
their relative arrangement. The fix is session-scoped; cancellation aborts it.
No native fix runs in mock mode or before consent. Later snoozes for 600000 ms.
Portrait requires 2500 ms confirmation outside the 6000 ms landscape guard.

Windows uses the allowlisted `ms-settings:display` deep link. A read-only
PowerShell probe uses Windows Forms screen sizes and WMI monitor names, preserving
its evidence independently of confirmed Electron bindings. The
`DisplaySwitch.exe /extend` adapter runs only on Windows after explicit consent.
Re-detect polls every 500 ms through 5000 ms, then publishes its final diagnostic
after another 1500 ms. Probe and repair failures retain their catalog identity.
Linux exposes orientation guidance;
it has no assumed desktop-specific settings command. Preload exposes the fixed
platform capabilities so the diagnostic only offers supported actions. Native
layout repair is also hidden in mock mode.

A read-only `/usr/sbin/system_profiler SPDisplaysDataType -json` probe also detects
a DK-QUAKE hidden from Electron by mirroring on first launch. That prompt opens
Display Settings so the user can extend it. Automatic CoreGraphics repair requires
an Electron-visible target ID. Diagnostics keep HDMI failed until the strip is
identified with valid physical dimensions, including the first USB connection
notification. A unique size match alone cannot pass HDMI for a real device.
Readiness loss returns Screen to Connection once; deliberate offline preview
remains available. Dock activation restores management even when its hidden
fallback panel is still alive.

The diagnostic uses recovered English `quakeDiagnostic` and `displayMode` copy.
The mirror detail replaces DK-Suite's destructive decline warning with an accurate
Later/snooze explanation, as required by this lane. Arrangement-only prompts say
they will move the strip rather than incorrectly claiming it is mirrored.
It shows USB/HDMI independently, including physical resolution mismatch, and
preserves desktop preview without hardware. `quake:lifecycle` accepts only
schema-decoded commands from the exact renderer document, its main frame, and
the main-owned management WebContents. Query parameters grant no permission.
Only status and allowlisted catalog codes cross IPC. No arbitrary execution,
network listener, or native cause is exposed.

Tests use fake HID, mocked Electron/native edges and Effect TestClock. Run the
native media smoke from `../media/README.md` with `OPEN_QUAKE_MOCK_DEVICE=1` and a
scratch TMPDIR; it now exercises real diagnostic preload/IPC, disabled Re-detect,
resolution mismatch, ready state and a rejected panel mutation. Hardware screen
power, timing, wake recovery and CoreGraphics effects need lead verification.

## Lifecycle burn-down acceptance

The main process owns windows by serial. Stable recovery reserves candidate IDs,
then unique prior bounds, then a sole remaining device/candidate pair. Reused IDs
on desktop displays never bind. Meaningful topology bursts debounce for 1500 ms;
workArea changes do nothing. Lock cancels pending generations, and wake parks
all serials before the 2500 ms recovery delay. One app-suspension blocker spans
the first through last connected device, including USB grace.

The setup wizard subscribes to typed orientation snapshots and polls every two
seconds. Valid dimensions determine orientation before rotation. Hardware needs
connected landscape to continue; offline preview stays available. Opening setup
suppresses orientation prompts until it closes, reloads or is destroyed.

The dedicated smoke uses hidden windows, the production preload/renderer and
mock hardware. It captures portrait and landscape in EN/DE and checks hardware
continuation, disconnect exit with saved progress, and offline preview:

```sh
pnpm --filter @open-quake/desktop exec electron-vite build --config src/main/lifecycle/smoke.config.ts
env -u ELECTRON_RUN_AS_NODE OPEN_QUAKE_MOCK_DEVICE=1 pnpm --filter @open-quake/desktop exec electron out/lifecycle-smoke/smoke.js "<absolute-screenshot-dir>"
```

Set `TMPDIR` to the external lane scratch directory for both commands. No native
host repair, real HID, microphone or audible playback runs in this smoke.
