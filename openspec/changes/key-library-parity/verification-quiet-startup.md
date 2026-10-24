# Quiet live-device startup and resume verification

Tested source: `451f10873a907f95f30cdd7564e957a8e95a4693`. Base: main `133819c3192f73529107056e672046e082ec3fa5`.
Bead `open-quake-lih.10.2.21`; key-library task 8.2 and device-lifecycle live follow-up.

## Result

The production app now enrolls the real device serial for the native connection scope, removes it on disconnect, and enrolls it again on reconnect. A sole exact DK-QUAKE display with physical dimensions 1920×480 in either orientation binds without a topology disappearance. Near-size, unnamed and ambiguous candidates retain the power-cycle pairing path.

Live testing also found a resume cancellation race. HID reopening can cancel a newly forked discovery operation before its first instruction. Its in-body finalizer never installed, leaving `checking=true` indefinitely and the panel hidden. Discovery now registers a runtime completion observer while acquisition is protected from interruption, releasing the reservation even when the child never starts. The discovery body and join remain interruptible.

## Verification

- Six fresh gates pass: Biome checked 804 files; forced typecheck, tests and build; desktop bundle smoke in both modes; all 40 strict OpenSpec items. Tests: **1,771 across 188 files**.
- Main-composition, discovery and lifecycle regressions pass: 49 tests. Enrollment and direct-display tests failed before their fixes. The 1919px near-match regression failed before the exact-size guard. The resume consumer failed with `checking=true` before completion-observer cleanup.
- Sequential native management and media smokes exit 0 with their full required PASS markers. There are 69 management and 16 media captures, all hashed. These fixtures use mocks and local integration stubs.
- Production Electron bundle opened the real FF60/61 interface, with mock mode disabled and firmware 1.0.19. Startup reports one profile device, USB/HDMI pass, `checking=false`, `issue=none`, and the visible panel bound to the OS-reported 480×1920 strip at x=-480/y=0.
- Two consecutive software resume/reopen cycles each create a different hardware session, retain exactly one enrolled serial, settle discovery and restore the visible panel. The buzzer remains disabled during each run.
- A clean generated 170×170 PNG passes manager creation, target-bound preview, explicit Save and real-device selection. The actual panel renderer loads the image and title. The captured rotated renderer image was viewed.
- Original hardware preferences were restored and acknowledged as saved after every live run. Owned live processes exited. User profile storage and the clipboard were untouched; synthetic profiles exist only in the isolated evidence user-data directory.

## Evidence and retained failures

Local evidence root: `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/live-quiet-2026-10-24/`.

- `gates/verification.json`, six gate logs, final management/media native logs, and `capture-hashes-final.json`.
- `results/018-fixed-startup.json`, `020-fixed-reopen.json`, `021-fixed-reopen-repeat.json`, `023-fixed-resource-unique.json`, `024-restore-and-stop.json`.
- `quiet-resource-panel.png` and `reopen-fixed-live.log`.
- `red-consumers-serial.log`, `red-near-size.log`, `red-reopen-consumer.log` and their green counterparts.
- `traced-live.log` records the cancelled discovery fork being assigned without ever entering its body. The temporary trace touched only the generated bundle and was replaced by the final production build.
- Earlier type widening, lifecycle test-fixture mismatches and an unsynchronized new assertion are retained. Reusing a native artifact directory produced four export files where the fixture expected two; the final run uses fresh directories. Resource fixture attempts also retained a rejected overlong name and a duplicate-name rejection; the corrected unique-name path passes. Electron's console-message deprecation diagnostic remains in the native log.

## Limits

macOS reports the GUI session locked. Peekaboo cannot capture the actual display and Electron desktop capture returns no screen sources. The renderer capture proves rendering and native window placement, not physical pixels or actual OS framebuffer output.

No physical cable unplug, physical touch, real shortcut/text receipt, audible alarm, messaging-app GIF draft or Windows acceptance is claimed. No real Home Assistant action ran. Quiet acceptance `.20`, full physical `.8`, icon presentation `.9`, native GIF and other acceptance parents remain open. Home Assistant stays last, and audible checks remain excluded by the user.

## PR36 corrupt-preferences review follow-up

Tested source `d6aa21e` enrolls the profile serial before optional hardware attachment. A malformed saved preferences file still produces the existing typed hardware warning, while the native connection scope owns profile cleanup. Devin review thread `discussion_r4368553790` identified this independent failure path.

The real main/fake-HID regression fails before the fix with zero enrollment calls and passes afterward with one enrollment, one disconnect and one native close. All 50 affected tests pass. Six fresh gates in a clean dedicated checkout pass: Biome 804 files, forced types/test/build, both bundle modes, and 40 strict OpenSpec items. There are 1,772 tests across 188 files. Sequential management and media native fixtures exit zero with their complete required markers; 69 management and 16 media captures are hashed. This follow-up changes no device command or display-discovery behavior and adds no physical acceptance claim.

Evidence: `live-quiet-2026-10-24/review-preferences/verification.json`, six gate logs, sequential native logs and `capture-hashes.json` under the evidence root above. Red and green logs are `red-corrupt-preferences.log` and `green-corrupt-preferences.log`. Task 8.3 and bead `.22` close only this review correction. Existing quiet and physical acceptance limits remain open.
