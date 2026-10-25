# Quiet keyboard, display and GIF acceptance

Verified on Ramiro's Mac mini and the real QUAKE on 2026-10-25. The tested tree starts at `86a8b687fd52de0b4d76242ade0dd6899d7fad4e` with the native display binding fix in this change. SHA-256 of `apps/desktop/src/main/lifecycle/native-display.ts`: `a538360d4e1fa4b94116f17a5e3ef2c18fd82f3f89022a4c38a3da1306255971`. No mock device was used for the live checks.

The single live owner exercised committed keys through production panel IPC and the QUAKE hardware keyboard. A temporary foreground receiver recorded trusted events for Command+A, Unicode text, text followed by Enter, alternating A/B and a text/Enter/text sequence. Every expected receiver value and selection matched. Clipboard formats and bytes were restored. This proves host keyboard output; it does not prove a manual finger press or knob gesture.

The previous harness installed a window-hiding handler using the title at creation time. Its desktop-only display capture was invalid evidence of panel failure. A fresh harness without the handler captured the actual DK-QUAKE display framebuffer with all test keys and artwork visible.

The user authorized display changes. The native layout helper initially aborted in JXA `ObjC.bindFunction` because `uint` is unsupported. Using `unsigned int` stopped that crash and exposed a second error: `CGBeginDisplayConfiguration` requires `void **`, not `void *`. The real helper then returned `applied` and moved DK-QUAKE from x=-480 to x=1280 without moving the main monitor. Two macOS regression tests exercise the actual production bindings: a read-only mirroring probe and begin/cancel of a configuration without committing it. The output-pointer test failed with status 1001 before the correction and passed afterward.

System Settings initially reverted the rotation before confirmation. The second attempt was confirmed and retained 270 degrees, yielding 1920×480. The rebuilt app followed the display and reported USB pass, HDMI pass, no resolution mismatch and issue `none`. The final display framebuffer shows the placed GIF tile and its saved artwork.

Messages accepted an actual GIF attachment in a new draft with no recipient, using the production emoji clipboard adapter and QUAKE Command+V. Global mode was 1, so no Enter was sent. The clipboard file retained a `.gif` extension and two animation frames. Five native draft captures showed only its first frame, so animation and receiving-app filename classification remain unverified. The attachment was removed and the empty draft window closed. Management task 7.3 and bead `open-quake-lih.17.1.26` remain open, including Windows acceptance.

Hardware sound was disabled throughout action testing. Shutdown restored the original captured hardware preferences, including buzzer=true and alert volume 84, and restored the clipboard. No audible action was invoked. No open-quake or DK-Suite process remained. The authorized display arrangement and rotation remain applied. No messages were sent. Home Assistant was deferred at the user's request.

Verification:

- Biome checked 811 files.
- Forced full tests passed: 1,783 tests in 189 files, including 36 lifecycle tests in five files.
- Forced full typecheck and build passed.
- Both bundle smoke modes passed without hardware I/O.
- Strict OpenSpec validation passed all 40 items.

The first desktop and strict-environment Turbo runs failed backup tests because macOS temporary paths traversed `/var` or `/tmp` symlinks. The backup guards correctly reject symlink ancestors. Direct desktop tests passed with an owned absolute TMPDIR. The full Turbo run passed with the same TMPDIR and `--env-mode=loose`, which forwards TMPDIR to child packages. No backup code or tests were weakened.

Evidence is local-only under `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/live-quiet-2026-10-24/`:

- `unlocked-display/results/003-keyboard.json`, receiver events and screenshot, and `device-visible.png`.
- `unlocked-display/display-tool-red.json`, `native-bindings-red.log`, `native-bindings-green.log`, and `display-tool-pointer-fix.json`.
- `fixed-display/results/002-diagnostic-emoji.json`, `device-final.png`, `results/005-paste-gif.json`, the cropped unsent-draft capture and `results/006-restore-stop.json`.
- `unlocked-display/final-all-tests-loose.log`, `final-all-typecheck.log`, `final-all-build.log`, `final-biome.log`, `final-bundle.log` and `final-openspec.log`.
- `unlocked-display/evidence-hashes.json` records nine retained evidence hashes.

This closes only quiet acceptance task 8.1 and the native helper task 8.7. Full physical acceptance, audible alarms, cable reconnection, manual controls and cross-platform GIF acceptance remain open. Prior settled software reconnect evidence is in `verification-quiet-startup.md`; this follow-up changes only native display bindings and their regression tests.
