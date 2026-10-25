import { Effect, Schema } from "effect";
import {
	KnobCapabilityUnavailable,
	type KnobError,
	KnobSessionStale,
} from "../../../../../packages/device/src/knob/knob-errors.js";
import type {
	FocusKey,
	KnobModelContext,
} from "../../../../../packages/device/src/knob/model/contracts.js";
import {
	Profile,
	type ProfileEnvelope,
	type ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { isUnsupportedProfileKey } from "../../../../../packages/device/src/profiles/profile-function-contracts.js";
import { visibleProfiles } from "../../../../../packages/device/src/profiles/profile-manager-invariants.js";

export interface FocusedKeyBindings {
	readonly read: Effect.Effect<ProfileEnvelope, KnobError>;
	readonly deviceId: () => string;
	readonly context: () => KnobModelContext | undefined;
	readonly profiles: () => readonly Profile[];
}

/** Every dispatch and pre-write guard reads the canonical committed owner. */
export const committedFocusedKey = (bindings: FocusedKeyBindings) =>
	Effect.fn("DesktopKnob.focusedKey")(function* (
		key: FocusKey,
		context: KnobModelContext,
	): Effect.fn.Return<ProfileKey, KnobError> {
		const serial = context.session.deviceId;
		const original = bindings
			.profiles()
			.find((profile) => profile.id === context.session.profileId);
		const current = () => {
			const loaded = bindings.context();
			return (
				bindings.deviceId() === serial &&
				loaded?.session.deviceId === serial &&
				loaded.session.profileId === context.session.profileId &&
				loaded.session.revision === context.session.revision &&
				loaded.pageId === context.pageId
			);
		};
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
			!committed?.config.display ||
			isUnsupportedProfileKey(committed) ||
			committed.config.type !== key.kind ||
			!committed.config.supportKnob
		)
			return yield* KnobCapabilityUnavailable.fromCause();
		return committed;
	});
