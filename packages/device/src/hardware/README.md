# QUAKE hardware controls

`HardwareControls` creates scoped controls over an existing `QuakeConnection`.
It never discovers or opens another device. Supply its serial descriptor and a
fresh session ID. `HardwarePreferencesStore` is the serial-scoped storage port;
`Default` supplies in-memory storage, while desktop supplies validated atomic
JSON under `hardware-v1/<sha256(serial)>.json`. Missing serials do not receive a
path-based substitute identity. Call `refresh()` to query version, mic and
native luminance before exposing mutations. Disconnect closes pending waits.

Every set consumes its generic ack, including keyboard, buzzer and LED writes.
One transaction runs at a time. The wire has no request IDs, so a timeout or
interrupted wait disables further transactions until a fresh connection.
Negative acks preserve the current snapshot. `available` and `errorCode` expose
failures; preference status distinguishes pending, saved and failed writes.
Writes and acks establish protocol delivery only, not physical application.

`hardwareKeyboardAdapter(session, host)` implements the existing
`KeyboardActionAdapter`. Provide it in `ActionHostAdapters.keyboard` before
constructing `ActionService`. Device keyboard is the app-lifetime default;
`setInputMode("host")` explicitly selects the supplied host adapter. The mode
survives reconnect in the same conductor and resets on app restart. Unsupported
chords fail before writing and never silently fall back. One command carries
one ordinary USB usage plus a modifier mask. Chords press, wait 50 ms, then
release. Failure or cancellation attempts release, even when the press ack is
lost. A failed cleanup remains a failed/poisoned session.

The profile/key and knob owners can bind the same keyboard adapter and call
`stepBrightness(-1 | 1)`, `toggleMic()`, `playTone("start" | "end" | "error" |
"busy")`, or `send({ _tag: "ScreenPower", on })`. Use keyboard action 2 for
single device-side detent taps. Brightness adds/subtracts 26 native units and
clamps to 25..255, independently of the old host-monitor percent adapter.
No automatic screen power cycle, firmware update, voice pipeline or profile
runtime is installed by this lane. These stay with their respective owners.

Tone steps use the configured nonzero alert volume, send zero after each
step, and wait 10 ms between steps. Disabled/silent settings play nothing.
Changing only the LED preference does not preview a tone. Volume changes
cancel the prior preview and debounce the latest by 300 ms. Settings debounce
disk persistence by 500 ms and flush on scope teardown. Teardown failure logs
the catalog code. It does not claim the preference was saved.

Desktop registration restricts IPC to the current management window's exact
renderer document and top-level frame. Mutations carry the session ID, never a
HID path. Lock/unlock call only the active session's LED policy and remove both
listeners during quit. The production mock factory and all tests use fake HID.

Evidence is in `openspec/changes/hardware-controls-parity/design.md` and
`verification.md`. Firmware reconstruction ambiguities are recorded there.
No physical keyboard output, luminance, microphone, LED, screen power, acoustic
volume or real-firmware ack behavior is qualified by these tests.
