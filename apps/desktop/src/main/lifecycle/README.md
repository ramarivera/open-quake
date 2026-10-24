# Device lifecycle

`device-lifecycle` owns the display pairing transaction, panel visibility,
connection diagnostics and host display prompts. `QuakeDevice` remains the only
HID owner. Screen power is opcode 1, command 4, value 0 or 1, encoded through the
existing protocol adapter. No second handle is opened for discovery.

Discovery subscribes before the off write, keeps topology snapshots, waits for a
unique disappearing candidate, restores power, and waits for its return. It
coalesces concurrent transactions and restores power on timeout or interruption.
The 30-second timeout leaves ambiguous displays unbound. Physical dimensions are
rounded `size * scaleFactor`; source comparison is strictly less than 10 pixels
from 1920x480 or 480x1920. This corrects the audit's inclusive-looking ±10 wording.

The panel hides on display loss. USB loss retains it through 3000 ms of grace.
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

Windows uses the allowlisted `ms-settings:display` deep link. The planned native
adapter is `DisplaySwitch.exe /extend`, behind `process.platform === "win32"`
and the same consent step. Native Windows enumeration and this action remain
future work as authorized by the lane brief. Linux exposes orientation guidance;
it has no assumed desktop-specific settings command.

A read-only `/usr/sbin/system_profiler SPDisplaysDataType -json` probe also detects
a DK-QUAKE hidden from Electron by mirroring on first launch. That prompt opens
Display Settings so the user can extend it. Automatic CoreGraphics repair requires
an Electron-visible target ID. Diagnostics keep HDMI failed until the strip is
identified with valid physical dimensions.

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
