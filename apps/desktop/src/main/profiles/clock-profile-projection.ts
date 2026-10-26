import { createHash } from "node:crypto";
import { Schema } from "effect";
import {
	encodeProfileEnvelope,
	Profile,
	ProfileEnvelope,
	ProfileJson,
	type ProfileJsonObject,
	ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";

const object = (
	value: ProfileJson | undefined,
): value is typeof ProfileJsonObject.Type =>
	value !== undefined &&
	value !== null &&
	typeof value === "object" &&
	!Array.isArray(value);
const reference = (path: string): string =>
	path.startsWith("clock-media:")
		? path
		: `clock-media:${createHash("sha256").update(path).digest("hex")}`;

/** Visit clock actions, including compatibility copies, without changing other action fields. */
function mapClockMedia(
	value: ProfileJson,
	path: (value: string) => string,
): ProfileJson {
	if (Array.isArray(value))
		return value.map((item) => mapClockMedia(item, path));
	if (!object(value)) return value;
	const result: typeof ProfileJsonObject.Type = Object.fromEntries(
		Object.entries(value).map(([name, item]) => [
			name,
			mapClockMedia(item, path),
		]),
	);
	if (
		value.type !== "clockStyle" ||
		!object(value.value) ||
		!object(value.value.background)
	)
		return result;
	const background = value.value.background;
	return {
		...result,
		value: {
			...value.value,
			background: {
				...background,
				...(typeof background.source === "string"
					? { source: path(background.source) }
					: {}),
				...(object(background.themes)
					? {
							themes: Object.fromEntries(
								Object.entries(background.themes).map(([theme, slot]) => [
									theme,
									object(slot) && typeof slot.path === "string"
										? { ...slot, path: path(slot.path) }
										: slot,
								]),
							),
						}
					: {}),
			},
		},
	};
}

export function encodeRendererProfiles(
	envelope: ProfileEnvelope,
): typeof ProfileEnvelope.Encoded {
	return Schema.decodeUnknownSync(Schema.encodedSchema(ProfileEnvelope))(
		mapClockMedia(
			Schema.decodeUnknownSync(ProfileJson)(encodeProfileEnvelope(envelope)),
			reference,
		),
	);
}
export function encodeRendererProfile(
	profile: Profile,
): typeof Profile.Encoded {
	return Schema.decodeUnknownSync(Schema.encodedSchema(Profile))(
		mapClockMedia(
			Schema.decodeUnknownSync(ProfileJson)(
				Schema.encodeSync(Profile)(profile),
			),
			reference,
		),
	);
}

/** A renderer can round-trip only media already owned by this exact saved key. */
export function restoreClockMediaReferences(
	key: typeof ProfileKey.Encoded,
	original: ProfileKey | undefined,
): typeof ProfileKey.Encoded {
	const paths = new Map<string, string>();
	if (original)
		mapClockMedia(
			Schema.decodeUnknownSync(ProfileJson)(
				Schema.encodeSync(ProfileKey)(original),
			),
			(path) => {
				paths.set(reference(path), path);
				return path;
			},
		);
	return Schema.decodeUnknownSync(Schema.encodedSchema(ProfileKey))(
		mapClockMedia(
			Schema.decodeUnknownSync(ProfileJson)(key),
			(path) => paths.get(path) ?? path,
		),
	);
}

export function rendererClockActions(
	actions: readonly { readonly type: string; readonly value: unknown }[],
) {
	return Schema.decodeUnknownSync(ProfileJson)(
		mapClockMedia(Schema.decodeUnknownSync(ProfileJson)(actions), reference),
	);
}
