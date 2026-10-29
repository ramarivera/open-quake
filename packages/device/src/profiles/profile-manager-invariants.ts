import { Array as EffectArray, Option, Schema } from "effect";
import { adaptHostShortcuts } from "./host-shortcuts.js";
import {
	builtinProfiles,
	isBuiltinProfile,
	profileText,
} from "./profile-catalog.js";
import {
	createEmptyProfileKey,
	Profile,
	type ProfileEnvelope,
} from "./profile-contracts.js";
import {
	type ManagerCommand,
	ProfileManagerState,
	type ProfilePlatform,
} from "./profile-manager-contracts.js";

export const PROFILE_LIMIT = 30;
export const weightedNameLength = (name: string): number =>
	name
		.split("")
		.reduce((total, unit) => total + (/[\u4e00-\u9fa5]/.test(unit) ? 2 : 1), 0);
export const truncateProfileName = (value: string): string => {
	let result = "";
	for (const point of value) {
		if (weightedNameLength(result + point) > 10) break;
		result += point;
	}
	return result;
};
export const managerState = (envelope: ProfileEnvelope): ProfileManagerState =>
	Option.getOrElse(envelope.manager, () =>
		Schema.decodeUnknownSync(ProfileManagerState)({
			revision: 0,
			installed: false,
			hidden: [],
			links: [],
			approvedCommands: [],
			userHasSetDefault: false,
		}),
	);
export const visibleProfiles = (
	envelope: ProfileEnvelope,
): readonly Profile[] =>
	envelope.profiles.filter(
		(p) => !managerState(envelope).hidden.includes(p.id),
	);
const reservedNames = [
	"Discord",
	"会议助手",
	"MeetAI",
	"炫彩屏幕",
	"Vivid",
	"快捷操作",
	"Quick",
	"系统监控",
	"SysView",
	"AI助手",
	"AI Chat",
	"音乐",
	"Music",
	"时钟",
	"Clock",
];
export type ManagerRejection =
	| "limit"
	| "last-builtin"
	| "builtin"
	| "missing"
	| "name"
	| "duplicate"
	| "confirmation"
	| "subpage";
export type ManagerTransition =
	| { readonly _tag: "updated"; readonly envelope: ProfileEnvelope }
	| { readonly _tag: "rejected"; readonly reason: ManagerRejection };
export const installProfileCatalog = (
	envelope: ProfileEnvelope,
	platform: ProfilePlatform,
): ProfileEnvelope => {
	const state = managerState(envelope);
	if (state.installed) {
		const profiles = envelope.profiles.map((profile) =>
			adaptHostShortcuts(profile, platform),
		);
		if (
			profiles.every((profile, index) => profile === envelope.profiles[index])
		)
			return envelope;
		return {
			...envelope,
			profiles: [profiles[0] ?? envelope.profiles[0], ...profiles.slice(1)],
		};
	}
	const profiles = [
		...builtinProfiles(platform),
		...envelope.profiles.filter((p) => !isBuiltinProfile(p.id)),
	];
	return {
		...envelope,
		profiles: [profiles[0] ?? envelope.profiles[0], ...profiles.slice(1)],
		manager: Option.some({
			...state,
			installed: true,
			hidden: platform === "darwin" ? ["1-0"] : [],
			revision: state.revision + 1,
		}),
	};
};
const customNumber = (name: string): number =>
	Number(/^Custom(\d+)$/.exec(name)?.[1] ?? 0);
export const applyManagerCommand = (
	envelope: ProfileEnvelope,
	command: ManagerCommand,
): ManagerTransition => {
	const state = managerState(envelope);
	let profiles: readonly [Profile, ...Profile[]] = envelope.profiles;
	let nextState = state;
	let selections = envelope.activeByDevice;
	const profile =
		"id" in command ? profiles.find((p) => p.id === command.id) : undefined;
	const reject = (reason: ManagerRejection): ManagerTransition => ({
		_tag: "rejected",
		reason,
	});
	if ("id" in command && !profile) return reject("missing");
	const active = selections["desktop-preview"]?.profileId;
	const select = (id: string): void => {
		const target = profiles.find((p) => p.id === id);
		if (target)
			selections = {
				...selections,
				"desktop-preview": { profileId: target.id, pageId: target.pages[0].id },
			};
	};
	switch (command.type) {
		case "create":
		case "duplicate": {
			if (visibleProfiles(envelope).length >= PROFILE_LIMIT)
				return reject("limit");
			const n = Math.max(0, ...profiles.map((p) => customNumber(p.name))) + 1;
			const copyText =
				command.type === "duplicate"
					? profileText("functionWheelEditor.copy", command.locale ?? "en")
					: "";
			const suffix = ` - ${copyText}`;
			const copyBase =
				profile?.name.replace(new RegExp(`${suffix}\\d+$`), "") ?? "";
			const copyNumber =
				Math.max(
					0,
					...profiles
						.filter(
							(p) => p.name.startsWith(copyBase) && p.name.includes(copyText),
						)
						.map((p) =>
							Number(new RegExp(`${suffix}(\\d+)$`).exec(p.name)?.[1] ?? 0),
						),
				) + 1;
			let idNumber =
				Math.max(
					0,
					...profiles.map((p) => Number(/^custom-(\d+)$/.exec(p.id)?.[1] ?? 0)),
				) + 1;
			idNumber = Math.max(idNumber, state.nextId);
			while (profiles.some((p) => p.id === `custom-${idNumber}`)) idNumber++;
			nextState = { ...nextState, nextId: idNumber + 1 };
			const custom =
				command.type === "duplicate" && profile
					? {
							...profile,
							id: `custom-${idNumber}`,
							name: `${copyBase}${suffix}${copyNumber}`,
							revision: 0,
							compatibility: Option.none(),
						}
					: Schema.decodeUnknownSync(Profile)({
							id: `custom-${idNumber}`,
							name: `Custom${n}`,
							revision: 0,
							pages: [
								{
									id: "1",
									keys: Array.from({ length: 16 }, (_, i) =>
										Schema.encodeSync(ProfileKeyForTemplate)(
											createEmptyProfileKey(
												`${Math.floor(i / 8) + 1},${(i % 8) + 1}`,
											),
										),
									),
								},
							],
							knob: {
								keyCode: "0,1",
								config: {
									type: "knob",
									icon: "0-50",
									subActions: [
										{
											type: "assistant",
											animations: ["0-47", "0-48", "0-49", "0-51"],
											actions: [
												{ type: "voiceRoute", value: "legacyAssistant" },
												{ type: "assistant", value: "" },
											],
										},
									],
								},
							},
						});
			const customs = profiles.filter((p) => !isBuiltinProfile(p.id));
			const defaults = profiles.filter((p) => isBuiltinProfile(p.id));
			const after = customs.findIndex((p) => p.id === profile?.id) + 1;
			profiles = [custom, ...defaults, ...customs];
			if (command.type === "duplicate") {
				const ordered = [
					...defaults,
					...customs.slice(0, after),
					custom,
					...customs.slice(after),
				];
				profiles = [ordered[0] ?? custom, ...ordered.slice(1)];
			}
			select(custom.id);
			break;
		}
		case "rename": {
			if (isBuiltinProfile(command.id)) return reject("builtin");
			const name = command.name.trim();
			if (!name || weightedNameLength(name) > 10) return reject("name");
			if (
				reservedNames.includes(name) ||
				profiles.some((p) => p.id !== command.id && p.name === name)
			)
				return reject("duplicate");
			profiles = EffectArray.map(profiles, (p) =>
				p.id === command.id ? { ...p, name, revision: p.revision + 1 } : p,
			);
			break;
		}
		case "delete": {
			if (isBuiltinProfile(command.id)) return reject("builtin");
			if (!command.confirmed) return reject("confirmation");
			const remaining = profiles.filter((p) => p.id !== command.id);
			const first = remaining[0];
			if (!first) return reject("missing");
			profiles = [first, ...remaining.slice(1)];
			const anchor = Option.getOrUndefined(state.anchor);
			const fallback =
				profiles.find((p) => p.id === anchor && !state.hidden.includes(p.id)) ??
				profiles.find((p) => !isBuiltinProfile(p.id)) ??
				profiles.find((p) => !state.hidden.includes(p.id)) ??
				first;
			if (active === command.id) select(fallback.id);
			selections = Object.fromEntries(
				Object.entries(selections).map(([serial, s]) => [
					serial,
					s.profileId === command.id
						? { profileId: fallback.id, pageId: fallback.pages[0].id }
						: s,
				]),
			);
			nextState = {
				...nextState,
				anchor:
					active === command.id || anchor === command.id
						? Option.some(
								selections["desktop-preview"]?.profileId ?? fallback.id,
							)
						: state.anchor,
				links: state.links.filter((link) => link.profileId !== command.id),
				startup: Option.filter(state.startup, (id) => id !== command.id),
			};
			break;
		}
		case "default-visibility": {
			const ids = new Set(command.ids);
			if (
				ids.size !== command.ids.length ||
				command.ids.some(
					(id) => !profiles.some((p) => p.id === id && isBuiltinProfile(id)),
				)
			)
				return reject("missing");
			if (ids.size === 0) return reject("last-builtin");
			const hidden = [
				...new Set([
					...state.hidden.filter((id) => !isBuiltinProfile(id)),
					...profiles
						.filter((p) => isBuiltinProfile(p.id) && !ids.has(p.id))
						.map((p) => p.id),
				]),
			];
			if (profiles.filter((p) => !hidden.includes(p.id)).length > PROFILE_LIMIT)
				return reject("limit");
			nextState = {
				...state,
				hidden,
				startup: Option.filter(state.startup, (id) => !hidden.includes(id)),
			};
			const ordered = [
				...profiles.filter((p) => isBuiltinProfile(p.id)),
				...profiles.filter((p) => !isBuiltinProfile(p.id)),
			];
			profiles = [ordered[0] ?? profiles[0], ...ordered.slice(1)];
			const fallback = profiles.find((p) => ids.has(p.id));
			if (fallback)
				selections = Object.fromEntries(
					Object.entries(selections).map(([serial, selection]) => [
						serial,
						hidden.includes(selection.profileId)
							? { profileId: fallback.id, pageId: fallback.pages[0].id }
							: selection,
					]),
				);
			break;
		}
		case "visibility": {
			if (!isBuiltinProfile(command.id)) return reject("builtin");
			const hidden = command.visible
				? state.hidden.filter((id) => id !== command.id)
				: [...new Set([...state.hidden, command.id])];
			if (
				!profiles.some((p) => isBuiltinProfile(p.id) && !hidden.includes(p.id))
			)
				return reject("last-builtin");
			if (profiles.filter((p) => !hidden.includes(p.id)).length > PROFILE_LIMIT)
				return reject("limit");
			nextState = {
				...nextState,
				hidden,
				startup: Option.filter(state.startup, (id) => !hidden.includes(id)),
			};
			const fallback = profiles.find((p) => !hidden.includes(p.id));
			if (fallback)
				selections = Object.fromEntries(
					Object.entries(selections).map(([serial, s]) => [
						serial,
						hidden.includes(s.profileId)
							? { profileId: fallback.id, pageId: fallback.pages[0].id }
							: s,
					]),
				);
			break;
		}
		case "select":
			if (state.hidden.includes(command.id)) return reject("missing");
			select(command.id);
			nextState = { ...nextState, anchor: Option.some(command.id) };
			break;
		case "startup":
			if (command.id.includes(",")) return reject("subpage");
			if (
				command.enabled &&
				Option.isSome(state.startup) &&
				state.startup.value !== command.id &&
				!command.confirmed
			)
				return reject("confirmation");
			nextState = {
				...nextState,
				startup: command.enabled
					? Option.some(command.id)
					: Option.filter(state.startup, (id) => id !== command.id),
				userHasSetDefault: command.enabled || state.userHasSetDefault,
			};
			break;
		case "link":
			if (command.link && command.link.profileId !== command.id)
				return reject("missing");
			nextState = {
				...nextState,
				links: [
					...state.links.filter((l) => l.profileId !== command.id),
					...(command.link ? [command.link] : []),
				],
			};
			break;
	}
	// Fixed catalog menu order, followed by customs in their existing order.
	const ordered = [
		...builtinOrder(profiles),
		...profiles.filter((p) => !isBuiltinProfile(p.id)),
	];
	const first = ordered[0];
	if (!first) return reject("missing");
	return {
		_tag: "updated",
		envelope: {
			...envelope,
			profiles: [first, ...ordered.slice(1)],
			activeByDevice: selections,
			manager: Option.some({ ...nextState, revision: state.revision + 1 }),
		},
	};
};

import { BUILTIN_PROFILES } from "./profile-catalog.js";
import { ProfileKey as ProfileKeyForTemplate } from "./profile-contracts.js";

const builtinOrder = (profiles: readonly Profile[]): readonly Profile[] =>
	BUILTIN_PROFILES.flatMap((b) => profiles.filter((p) => p.id === b.id));
