import { Array as Arr, Option, Schema } from "effect";
import {
	type ProfileEnvelope,
	ProfileJsonObject,
} from "./profile-contracts.js";

const record = (value: unknown) => {
	const result = Schema.decodeUnknownEither(ProfileJsonObject)(value);
	return result._tag === "Right" ? result.right : undefined;
};
/** AI-117 / MGMT-359 / SETTINGS-110: read/import repair, only the explicit title lock changes. */
export function upgradeAssistantTitle<
	K extends {
		readonly config: {
			readonly type?: unknown;
			readonly title?: unknown;
			readonly actions?: unknown;
			readonly basicEditableItems?: unknown;
		};
	},
>(key: K): K {
	const config = key.config;
	const title = record(config.title);
	const policy = config.basicEditableItems;
	const wrapped = Option.isOption(policy);
	const flags = record(wrapped ? Option.getOrUndefined(policy) : policy);
	if (config.type !== "aiChat" || flags?.title !== false) return key;
	const keys = [
		"contentWriter",
		"translate",
		"term",
		"math",
		"search",
		"compliance",
	].map((k) => `defaultAiCopilotChatConfig.${k}`);
	const roles = [128, 6, 8, 93, 129, 84];
	const role = Array.isArray(config.actions)
		? config.actions.map(record).find((a) => a?.type === "roleConfig")
		: undefined;
	if (
		!keys.includes(String(title?.i18nKey)) &&
		!roles.includes(Number(record(role?.value)?.roleId))
	)
		return key;
	return {
		...key,
		config: {
			...config,
			basicEditableItems: wrapped
				? Option.some({ ...flags, title: true })
				: { ...flags, title: true },
		},
	};
}
export function upgradeAssistantTitles(
	envelope: ProfileEnvelope,
): ProfileEnvelope {
	let changed = false;
	const profiles = Arr.map(envelope.profiles, (profile) => ({
		...profile,
		pages: Arr.map(profile.pages, (page) => ({
			...page,
			keys: page.keys.map((key) => {
				const next = upgradeAssistantTitle(key);
				changed ||= next !== key;
				return next;
			}),
		})),
	}));
	return changed ? { ...envelope, profiles } : envelope;
}
