# Vendor touch input

This module is owned by `QuakeDevice`. A connection starts a scoped touch reader
through the same injected `HidTransport` as its control handle, selecting only
0712:0010 usagePage FF73 usage 71. It never writes to the touch controller.
The 0D/04 digitizer, FF00/1 and generic desktop collections are rejected.
The lead confirmed collection presence by ioreg on 2026-10-23. No hardware
frames were captured in this lane.

The source-derived raw layout is:

```
0       A3
1..2    opaque, not interpreted as a control length/opcode
3       1A
4       contact count, 0..5
5+5*i   raw action byte
6+5*i   y low
7+5*i   y high
8+5*i   x low
9+5*i   x high
```

The parser requires every declared contact byte, accepts trailing bytes and does
not infer a checksum or report-ID prefix. Fixtures are synthetic, visibly labelled
in `touch-fixtures.ts`. Physical report lengths, padding, report IDs and coordinate
ranges remain hardware-unverified.

DK-Suite's `_trackPoints` ignores each parsed action byte and treats every contact
present in a frame as active. Releases come from absent contacts, distance changes
above 99 px or 100 ms without a valid frame. This implementation preserves raw
actions in parsing and the presence-based tracking behavior. IDs match greedily
by nearest neighbour within 99 px, consuming each new point once. IDs use session
counters. Unlike DK-Suite's idle callback, timeout releases clear the stored active
frame, so later input cannot revive an already lifted contact ID. Invalid reports
do not refresh the deadline.

`connection.touch` exposes Effect methods:

- `setCaptureActive(boolean)` suppresses idle release during voice capture. False
  rearms a 100 ms deadline. A real empty frame still releases contacts.
- `setLocked(boolean)` interrupts and closes the current reader while locked;
  unlocking schedules wake recovery.
- `wake()` resets backoff and cancels the previous wake generation. Recovery tries
  after 1500 ms, then 4500 ms after a failure, then ordinary retries.
- `health` reads state, report/frame counts, bind attempts, recovery cycle and an
  optional catalog error code. No native paths, messages or original causes cross
  this boundary. Device lifecycle/voice owners can bind OS and capture events to
  these methods.

Normal binding polls every 2000 ms. Five failures escalate to 10/15/20/25/30 s,
with a 60 s minimum for empty VID/PID enumeration. The reader closes on stream
end/error, releases held contacts and retries after 2000 ms. This does not stop
control-channel keep-alives. Closing the parent connection cancels every pending
attempt and deadline and closes each acquired touch handle once. Native opening
uses exclusive mode only for the exact vendor-touch identity on macOS. The connected
controller exposes digitizer/mouse and vendor-touch usages at one native path, so
seizing that path prevents duplicate OS pointer input while the scoped raw-touch
reader owns it. Control and other native opens stay non-exclusive. Closing the
existing connection releases ownership; physical cursor suppression still requires
a touch acceptance check. Native failure translation uses the existing device
catalog and retains private scrubbed diagnostic causes.

## Lead-only capture

The agent did not execute `scripts/capture-touch.mjs`. From the worktree root,
after stopping every open-quake and DK-Suite process, the lead can run:

```sh
node packages/device/scripts/capture-touch.mjs --capture \
  --out /Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/strip-touch/touch-capture.jsonl \
  --duration-ms 5000
```

The explicit flag is required. Process guards run before native import and again
before open. The script refuses a missing/ambiguous collection, writes only to a
canonical path inside strip-touch scratch with exclusive creation, caps duration
at 60 s and frames at 10000, and closes on timeout, SIGINT, SIGTERM or read/write
failure. It sends no HID commands. Its pure process/path/collection guards are
unit tested without importing the capture entry point or native HID.

Research: local `~/dev/dark-encyclopedia/dk-suite-introspeccion/v0.4.95/`,
`audit/AUDIT_MAIN.md` MAIN-002, 035–041 and `app-resources/background.js`, methods
`_checkAndConvertToCoordinate`, `_trackPoints`, `_sendTimoutUpEvent`,
`bindTouchHidDevice`, `_scheduleBindRecovery`. Also recovered renderer
`src/views/Components/QuakeShortCutView.vue` and `src/views/DKQuake/QuakeScreenView.vue`.
Recovered proprietary source stays local; this module implements the observed
contract without redistributing it.
