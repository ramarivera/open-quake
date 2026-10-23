# Knob contracts and conductor

This module implements the contract and routing portions of `openspec/changes/knob-configuration`. It performs no HID, OS brightness, profile persistence, microphone, or voice runtime IO. Physical direction, panel target/native scale/readback, and press/hold timing remain unverified.

## Canonical saves

Use `validateKnobResource(value, registry)` for newly authored saves. `KnobResource` checks structure; the validator additionally delegates nonempty slot actions to their registered function validator and checks slot capabilities. Left and right require rotation support. Center requires rotation, press, or hold support, so hold-only assistant assignments belong at center. The reserved key is `0,1`, the config type is `knob`, and the three slots are center, left, right. Empty slots are `{childrenName:'',config:{type:'',actions:[]}}`. `replaceKnobSlot` changes one position without compacting or mutating the others.

The common title matches the profile specification. It is declared here so this lane does not import or modify the parallel profiles module. Profile saves and duplicate-knob/page-key rejection belong to that module; `extractLegacyKnob` rejects multiple reserved entries in a flat import and returns independently copied unrelated keys.

`KNOB_OWNED_CAPABILITIES` validates navigation, panelBrightness, and assistant configuration. Navigation has no page-selection implementation here. Panel brightness requires one stepPercent from 1 through 100; callers author a default of 5. Its rotation descriptor does not qualify a hardware target or enable an adapter. The action lane supplies its registry validators for other function types. Register each function once and use the same registry for saves and dispatch.

Voice actions require an explicit route and unique field discriminators. Direct actions include directProvider and directModel strings. Empty strings represent an incomplete editable assignment; `directKnobRouteReferences` returns None until both are nonblank. The AI lane owns credentials. A profile must never put credentials in route actions. dkclaw and legacyAssistant schemas preserve settings; no runtime is enabled here.

## Supported import shapes

`migrateKnobResource` takes a user-selected JSON resource with `keyCode:'0,1'`, `config.type:'knob'`, and `config.subActions`. It returns a versioned `KnobImport` envelope with a canonical resource, untouched copied original JSON, diagnostics, inactive payloads, and optional legacy route-lock metadata. Keep the entire envelope when saving imports. Do not persist just its executable resource and lose compatibility data. Schema encode/decode provides JSON serialization for the optional route lock.

Supported slot layouts are:

- Exactly three indexed positions. Explicit nulls, empty objects, and canonical empty sentinels retain their positions.
- Short arrays containing explicit holes. Missing trailing positions become empty.
- A single known recovered center preset: assistant, brightness, luminance, homeAssistant, hotkey, media, goToPage, previousPage, nextPage, or canonical panelBrightness. Recovered pageUp/pageDown containers additionally require the matching outer previousPage/nextPage childrenName and explicit navigationContext. Known placement does not imply runtime availability. brightness/luminance remain inactive because their target is unverified; unsupported functions remain inactive unless the supplied registry validates them.
- Explicit tagged assignments, such as `{slot:'right',childrenName:'nextPage',config:{type:'nextPage',actions:[]}}`. Every nonempty entry must carry a valid unique slot tag.
- Empty arrays, which produce three empty slots.

A compact two-entry list without reliable slot tags stays entirely inactive in `compatibility.inactiveSlots.compact`. A single unknown preset also stays ambiguous. No guessed left/right assignment is made. Raw unknown slot data, unsupported slot capabilities, malformed assistant actions, and unknown routes remain in compatibility, with empty executable positions. Other valid slots still import. Invalid reserved identity, too many slots, duplicate tags, duplicate reserved knobs, and duplicate voice discriminators reject the import, including duplicate discriminators with malformed values.

`migrateKnobVoiceActions` splits old model references at the first slash, fills missing or blank route-specific fields, removes model and out-of-route actions, and retains the complete original JSON. Missing route and assistant/legacy aliases normalize to legacyAssistant only during import. Unknown routes stay inactive, without redirection. dkclaw agentId defaults to main. Built-in route locks are metadata; they never override explicit direct settings, including in custom profiles. Both migration functions accept their returned envelope unchanged, so repeated normalization preserves the original backup and diagnostics.

pageUp/pageDown aliases normalize only with `{navigationContext:true}`. The caller must establish navigation context from the import, rather than infer it globally from a type string. Imported malformed titles reject root validation or make the affected slot inactive.

## Normalized integration contract, W4 contract side

`KnobEvent` defines these decoded host events. This is an integration contract, not a protocol opcode map. `packages/protocol` is unchanged.

Every event carries `session:{deviceId,sessionId,profileId,revision}`. IDs are nonblank stable strings; revision is a nonnegative safe integer identifying committed data. The composition root allocates a fresh sessionId on reconnect and profile selection, including switching away and back. It never relabels queued old events with the new selection. A save publishes its new revision atomically. Events for an older revision are stale and must be replaced by fresh normalized input, never replayed.

- Rotate carries direction counterclockwise or clockwise and positive safe-integer detents. One detent selects one route from one fresh committed snapshot. Counterclockwise is left; clockwise is right. L1 must verify how physical input maps to this direction. Input adapters should emit small bounded batches for cancellation responsiveness.
- Press carries a pressId unique within that session and starts a gesture. It never dispatches a short action immediately.
- HoldStart carries the same pressId. The upstream voice/input classifier emits it at most once after Press. This module specifies no millisecond threshold and does not classify raw input.
- Release carries the same pressId and classification short, held, or cancelled, supplied by that classifier. Only short can dispatch a press-capable center. A consumed hold cannot dispatch a short action even if a later classifier result incorrectly says short.
- Disconnect invalidates that session. The composition root also cancels resources owned by voice. Late rotate/hold/release events fail with KnobSessionStale.

L1 and voice owners still need to verify their adapters against this contract. Hardware timing/direction and voice lifecycle integration are not completed by defining the schemas.

## Composition and dispatch

Provide `KnobDispatchPorts` to `KnobService.DefaultWithoutDependencies` at the app root. Ports contain the function registry, a `readSnapshot(deviceId)` callback returning the encoded `KnobSnapshot`, and a `dispatch(command)` callback. The default layer is deliberately unavailable. No hardware or voice adapter is installed by importing this module.

Snapshots contain session, optional knob, and optional focused control. Omit absent JSON fields; Schema decodes them to Option. A focused control supplies visible, supportKnob, keyCode, and exactly two directional assignments. The action lane expands its ordered two-chord hotkey into two individually validated assignments: index 0 counterclockwise, index 1 clockwise. That expansion does not represent hotkeySwitch.

For each detent the conductor chooses a visible, supported, validated focus first, then the matching nonempty profile slot, then a center with declared rotation support. An invalid focused control cannot gain priority. A selected route that is invalid or unavailable fails without trying another route. Empty selections do nothing. Press/release use center only; panelBrightness is rotation-only. Configuration and snapshot reads do not execute actions. Dispatch is serialized, and a failed side effect is never retried automatically.

The dispatch callback MUST atomically compare all four session fields against current committed selection immediately before IO. This closes the race between snapshot read and adapter invocation. It must honor device/profile/revision ownership, enforce capability availability, execute exactly one operation, and reject stale commands with KnobSessionStale. The conductor re-reads before each detent and stops a batch on failure; completed earlier detents cannot be rolled back.

HoldStart currently consumes the gesture and reports KnobRouteIncomplete for incomplete direct settings, otherwise KnobCapabilityUnavailable. It never starts voice capture. The voice lane must supply capture start/end/cancel integration and prove cleanup before task 3.2 can close.

All dependency callbacks are translated at the boundary to catalog errors. Create leaves with `ErrorClass.fromCause(cause)` to retain the original non-enumerably; the normal Schema constructor remains available for codecs. Known catalog failures from dispatch keep their identity and original cause. Diagnostics use the existing bounded scrubber and never expose imported values or upstream messages. Consumers branch on tag/code and use the catalog policy to select user-visible fields.

Tests in `packages/device/test/knob/` property-check slots and route migrations and drive the conductor's actual dispatch callback, including focused precedence, per-detent snapshots, session races, duplicate releases, and dependency failures. They establish host contract behavior with controlled adapters; desktop/profile/action/voice integration and hardware qualification remain separate tasks.
