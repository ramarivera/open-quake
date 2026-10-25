import type { HardwareSession } from "@open-quake/device";
import { Effect, Either, Schema } from "effect";
import { HotkeyConfig } from "../../../../../packages/device/src/actions/action-contracts.js";
import { hardwareKeyboardAdapter } from "../../../../../packages/device/src/hardware/hardware-keyboard.js";
import {
	InvalidKnobConfig,
	KnobCapabilityUnavailable,
	KnobDispatchFailed,
	type KnobError,
	KnobSessionStale,
} from "../../../../../packages/device/src/knob/knob-errors.js";
import type { KnobModelContext } from "../../../../../packages/device/src/knob/model/contracts.js";
import type { KnobModelPort } from "../../../../../packages/device/src/knob/model/ports.js";
import {
	Profile,
	type ProfileEnvelope,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { visibleProfiles } from "../../../../../packages/device/src/profiles/profile-manager-invariants.js";

interface FocusedHotkeyBindings {
	readonly read: Effect.Effect<ProfileEnvelope, KnobError>;
	readonly deviceId: () => string;
	readonly hardware: () => HardwareSession | undefined;
	readonly context: () => KnobModelContext | undefined;
	readonly profiles: () => readonly Profile[];
}

/** Resolve from committed data, never from a renderer-supplied chord. */
export const focusedHotkey = (
	bindings: FocusedHotkeyBindings,
): KnobModelPort["focusedTurn"] =>
	Effect.fn("DesktopKnob.focusedHotkey")(
		function* (key, delta, context): Effect.fn.Return<void, KnobError> {
			const serial = context.session.deviceId;
			const session = bindings.hardware();
			const original = bindings
				.profiles()
				.find((profile) => profile.id === context.session.profileId);
			const current = () =>
				bindings.deviceId() === serial &&
				bindings.context()?.session.deviceId === serial &&
				bindings.context()?.session.profileId === context.session.profileId &&
				bindings.context()?.session.revision === context.session.revision &&
				bindings.context()?.pageId === context.pageId &&
				bindings.hardware() === session;
			if (!current()) return yield* KnobSessionStale.fromCause();
			const envelope = yield* bindings.read;
			if (!current()) return yield* KnobSessionStale.fromCause();
			const visible = visibleProfiles(envelope);
			const selected = envelope.activeByDevice[serial];
			const profile = visible.find(
				(candidate) => candidate.id === (selected?.profileId ?? visible[0]?.id),
			);
			const pageId = selected?.pageId ?? profile?.pages[0]?.id;
			if (
				!profile ||
				!original ||
				profile.id !== context.session.profileId ||
				profile.revision !== context.session.revision ||
				pageId !== context.pageId ||
				JSON.stringify(Schema.encodeSync(Profile)(profile)) !==
					JSON.stringify(Schema.encodeSync(Profile)(original))
			)
				return yield* KnobSessionStale.fromCause();
			const committed = profile.pages
				.find((page) => page.id === pageId)
				?.keys.find((candidate) => candidate.keyCode === key.keyCode);
			if (
				key.kind !== "hotkey" ||
				!committed?.config.display ||
				committed.config.type !== "hotkey" ||
				!committed.config.supportKnob
			)
				return yield* KnobCapabilityUnavailable.fromCause();
			const config = Schema.decodeUnknownEither(HotkeyConfig)(committed.config);
			if (Either.isLeft(config))
				return yield* InvalidKnobConfig.fromCause(config.left);
			// The schema requires both directional actions before the first side effect.
			if (!config.right.supportKnob)
				return yield* KnobCapabilityUnavailable.fromCause();
			if (!session) return yield* KnobCapabilityUnavailable.fromCause();
			const hardware = yield* session.snapshot();
			if (!current() || hardware.serial !== serial)
				return yield* KnobSessionStale.fromCause();
			if (!hardware.available)
				return yield* KnobCapabilityUnavailable.fromCause();
			yield* hardwareKeyboardAdapter(session)
				.pressChord(config.right.actions[delta === -1 ? 0 : 1].value)
				.pipe(
					Effect.matchEffect({
						onFailure: (cause) =>
							Effect.fail(KnobDispatchFailed.fromCause(cause)),
						onSuccess: () => Effect.void,
					}),
				);
		},
	);
