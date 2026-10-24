# PR34 emoji thumbnail and restore verification

Source: `d25fa8cded9d532e0e41a988b3411c846f76587f`, on integrated main `c60378fafcd041245a8c54ae329c87003f4fdcab`.

Registered thumbnail windows have read-only access to hashes referenced by their captured profile. Main-frame and renderer-origin checks remain required. Library reads, mutations, presses and unrelated hashes remain denied; capture registration is removed on completion/disposal. Capture waits for emoji images to load before saving the PNG. A cache version change invalidates old blank captures.

Emoji restore merges destination items, packages, drafts and static assets. It preserves destination application settings and existing profile links, deterministically remaps conflicting imported IDs, rewrites imported emoji key references, and maps package links through native profile merge. Both library files are staged with the merged result inside the existing atomic restore swap.

All six fresh gates passed: Biome, forced types, 1,649 uncached tests across 176 files, forced build, both bundle modes and 39 strict OpenSpec items. Focused regressions exercise restricted/revoked/subframe capture access, clean and populated restore, ID collisions, both retained/imported copy consumers, repeated restore and backup-only library input.

Six sequential native fixtures passed with process exit zero and exact final markers: management, meetings, module review, media, voice and weather/media. The production thumbnail IPC/capture path produced a PNG containing 2,388 yellow artwork pixels; the actual PNG was viewed. Populated restore proof passed inside Electron, including both copy consumers and repeat restore. Recorded 171 PNG hashes and compared all 65 management hashes to the fixture manifest. Thumbnail, caption editor and clock captures were viewed. All owned process groups were empty; synthetic data, TMPDIR and generated native bundles were removed. The checkout was clean before this documentation closure.

Retained failures: initial focused execution used macOS's symlinked default TMPDIR and was correctly rejected by backup path guards; rerun used an owned absolute scratch path. Typecheck caught fixture-nullability/encoded-action/bitmap-bound issues before the source commit. The collision fixture initially omitted placement-link persistence and was corrected to mirror production. The native runner initially expected the old 64-capture marker; the consumer exited zero with 65 captures, its exact marker was verified and remaining fixtures resumed without rerunning it.

Combined management, meetings, module-review and media consumers reported zero missing handlers. Isolated voice and weather fixtures retain 12 and 5 missing-handler diagnostics for owners outside those fixtures. No real keyboard, clipboard, external account, device, packaged application or messaging-app paste acceptance is claimed. Physical 6.3 and native GIF 7.3 remain open.

Complete evidence: `/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/management-center/lead-review-round-3/pr34/`, including verification.json, SOURCE-REVIEW.md, native-log-audit.json, captures-sha256.json, cleanup.json and prior-failures.md. Native artifacts: `management-center/review-round-1/parent-pr34-d25fa8c/` under the same scratch root.

Only task 7.12 and bead `open-quake-lih.17.1.36` close here. Current-head external review and merge remain pending. Source is also integrated into PR35 locally as `0f293dd`; its fresh six gates pass and native verification continues under key-library task 7.5.
