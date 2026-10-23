# W5 lighting verification

Implemented scope: tasks 1.1, 1.2, 1.3, 2.1, and 2.4. Ramiro approved the recommendations on 2026-10-23. Existing approved headings were retained; stale pending-decision prose was corrected. No dependency was added and no protocol codec was changed.

## Consumer contract

The application supplies `LightingTargetRegistry`, an infrastructure resolver from a selected serial/session to current private HID information and firmware-qualified capabilities. There is no default hardware registration. The existing HID discovery contract has no serial field, so choosing the first enumerated interface cannot establish identity.

`LightingService.Default` declares `LightingDevice.Default`, which declares `NodeHidLive`. Custom transports compose `LightingService.DefaultWithoutDependencies` with `LightingDevice.DefaultWithoutDependencies`, `HidTransport`, and `LightingTargetRegistry` at the root. The fake fixture demonstrates that composition.

- `select(target)` invalidates prior work, resolves the current session, checks binding evidence and protocol-version readback, then reads every supported readable field. Unknown v3 bindings expose unavailable controls without opening HID.
- `setDesired(target, input)` validates and queues the latest value per field. Its result acknowledges the desired edit only. `flush(target)` waits for matching set echoes and validated actual-value readback.
- `state()` exposes desired, confirmed applied, and optional explicitly saved snapshots. Errors keep desired edits and prior confirmed applied values.
- `save(target)` waits for pending applies, serializes Save and readback against field writes, and marks the captured snapshot saved only after the qualified completion contract. Edits arriving during Save remain unsaved.
- `deselect()` cancels pending work and waits for handle release. A sent native write settles before its handle closes. Timed-out or abandoned requests invalidate the connection. Reconnection performs fresh actual reads and never replays the old desired batch.

## Verification

All behavior below uses `packages/device/src/hid-fake.ts`, with real `packages/protocol/src/qmk.ts` codecs. The fixture registers two serial/session targets and puts the unrelated target first in discovery.

- Contract properties cover integer/range validation and color-schema round trips. Invalid byte values, effect IDs, color2 without a capability, and stale/malformed evidence reject before transport.
- Fake-HID tests cover serial selection, initial actual reads, target-switch late responses, detach, selection cancellation, protocol mismatch, unknown v3 bindings, and response timeouts without retries.
- Ordering tests cover 100 concurrent slider edits, independent fields, apply/readback before Save, edits arriving during Save, and handle release after an in-flight native write.
- Failure tests cover an echo without matching readback, failed Save with applied values retained, explicit retry, absent Save capability, read-only fields, qualified color2, and exact catalog identities with private original HID causes and scrubbed serialization.

Commands and final outcomes are recorded in the PR. Local gates include `pnpm install`, `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`, `pnpm --filter @open-quake/device exec vitest run test/lighting`, `openspec validate device-lighting-config`, and `git diff --check`. Desktop build is not required because this lane changes no desktop files.

Final results on 2026-10-23:

- `pnpm install`: exit 0, lockfile unchanged.
- `pnpm run lint`: exit 0, 79 files checked, no fixes.
- `pnpm run typecheck`: exit 0, 6 tasks successful, 5 cached; device compiled in this worktree.
- `pnpm run test`: exit 0, 3 test tasks successful, 2 cached. Device ran 68 tests in 9 files, including all 32 lighting tests. Unchanged protocol and desktop suites reused Turbo results for 25 and 87 tests respectively.
- `pnpm --filter @open-quake/device exec vitest run test/lighting`: exit 0, 32 tests in 4 files.
- `openspec validate device-lighting-config`: exit 0, valid.
- `git diff --check`: exit 0.

## Unverified and remaining work

Hardware field support, firmware ranges/effects, v3 menu bindings, per-key RGB, knob-specific transport, and EEPROM persistence after reboot remain unverified. Save success proves only the registered echo/readback contract. Desktop controls and preferences and their integration scenarios remain tasks 2.2, 2.3, and 3.2; hardware acceptance remains task 3.1.

## Beads handoff

No `bd` commands were run, per the lane brief. Parent updates for OpenSpec path `openspec/changes/device-lighting-config/`:

- Close task issues `open-quake-da4.1`, `.2`, `.3`, `.4`, and `.7` with this PR, the implementation in `packages/device/src/lighting/`, the tests in `packages/device/test/lighting/`, and gate results as evidence.
- Keep epic `open-quake-da4` and the remaining task issues open for desktop and hardware work.
- Create a follow-up task, "Add qualified QMK v3 lighting menu codecs and bindings". The existing legacy codec accepts one lighting selector for get, so it cannot encode/decode channel plus command-byte bindings. Add get/set/save codecs with response correlation tests in the L1-owned `packages/protocol` lane, then register firmware-matched evidence before enabling v3 fields. Link both `openspec/changes/device-lighting-config/` and `openspec/changes/two-layer-sdk/`.
