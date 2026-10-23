# Tasks

Create parent-owned Beads epic and one issue per checkbox, each linking this directory. First-release profile contracts and registry descriptors are dependencies; voice runtime implementation belongs to the voice lane.

## 1. First-release contracts and persistence

- [ ] 1.1 Record Ramiro's decisions on stable slot sentinels, focus precedence, panel brightness target/step, and direct-route defaults; verify design.md still identifies unverified physical direction and target details.
- [ ] 1.2 Add knob and route Schemas plus pure slot/route migrations in packages/device; verify right-only slot round-trip, duplicate rejection, model-reference migration, route field stripping, and normalization idempotence.
- [ ] 1.3 Connect profile-scoped knob saves and the three-slot desktop editor to the profile conductor; verify edits preserve unrelated keys, page changes preserve the knob, and switching profiles discards old editor state.
- [ ] 1.4 Add compatibility handling for known center presets and ambiguous compact arrays; verify explicit holes survive and ambiguous left/right data stays preserved but inactive, and document supported import shapes.

## 2. First-release rotation and navigation

- [ ] 2.1 Agree normalized rotate/detent/press/holdStart/release/session events with L1 and voice lanes; verify a written integration contract defines who classifies holds without changing L1 codecs here.
- [ ] 2.2 Implement the knob conductor and single-route event precedence with catalog errors; verify focused-key priority, one route per detent, empty-slot no-op, and old-session rejection through the actual dispatch consumer.
- [ ] 2.3 Register canonical previousPage/nextPage/goToPage assignments and narrow pageUp/pageDown imports; verify page boundaries, invalid targets, and no cross-profile side effects using the profile selection consumer.
- [ ] 2.4 Qualify a panel-only brightness adapter and native-to-percent conversion with L1/desktop evidence, then implement clamped steps; verify 98 plus 5 yields 100, unknown current value writes nothing, and unrelated monitor/RGB values do not change; document target limitations.

## 3. First-release direct voice configuration handoff

- [ ] 3.1 Add the direct provider/model editor and completeness checks without embedding credentials; verify missing model disables capture and route changes retain only allowed fields.
- [ ] 3.2 Compose the voice lane's capture capability and session cleanup into knob dispatch; verify one hold starts once, release ends once, profile change/disconnect cancels, and a consumed hold cannot also fire a short press; document the handoff.
- [ ] 3.3 Exercise real QUAKE rotation, brightness, page changes, and hold/release with the qualified voice runtime when hardware is available; verify firmware/session traces and visible/voice outcomes are attached, keeping hardware tasks open when unavailable.

## 4. Later route compatibility

- [ ] 4.1 Integrate dkclaw and legacyAssistant only after their runtime owners register capabilities; verify absent runtimes remain unavailable, imported route locks cannot override new custom profiles, and credentials stay outside profiles.

## 5. Integration close-out

- [ ] 5.1 Run knob/profile/action/voice integration scenarios and repository gates; verify saved configuration, runtime traces, diagnostic scrubbing, OpenSpec validation, and explicitly unresolved hardware/route evidence before closing issues.
