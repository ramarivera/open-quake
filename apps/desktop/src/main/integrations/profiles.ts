import { Effect, Array as EffectArray, Schema } from "effect";
import {
	Profile,
	ProfileEnvelope,
	ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts";
import {
	applyManagerCommand,
	PROFILE_LIMIT,
	visibleProfiles,
	weightedNameLength,
} from "../../../../../packages/device/src/profiles/profile-manager-invariants";
import { ProfileRepository } from "../../../../../packages/device/src/profiles/profile-repository";
import { ProfileService } from "../../../../../packages/device/src/profiles/profile-service";
import {
	InputRejected,
	ProfilePlacementFailed,
} from "../../../../../packages/edge/src/channels/integration-errors";
import {
	HaKey,
	type HaTarget,
} from "../../../../../packages/edge/src/home-assistant/ha-contracts";
import type { ShortcutLibrary } from "../../../../../packages/edge/src/shortcuts/shortcut-contracts";
import { executableChord } from "../../../../../packages/edge/src/shortcuts/shortcut-invariants";
import type { KeyTarget } from "../../shared/integrations";
import type { DesktopRuntime } from "../diagnostics/module";
export const keyHaConfig = (key: ProfileKey): HaKey | null => {
	if (key.config.type !== "homeAssistant") return null;
	const action = key.config.actions.find(
		(a) =>
			a.type === "configData" ||
			a.type === "haConfig" ||
			a.type === "homeAssistant",
	);
	if (!action) return null;
	try {
		const decoded = Schema.decodeUnknownEither(HaKey)(
			typeof action.value === "string"
				? JSON.parse(action.value)
				: action.value,
		);
		return decoded._tag === "Right" ? decoded.right : null;
	} catch {
		return null;
	}
};
export const visibleHaEntities = (
	envelope: ProfileEnvelope,
): readonly string[] => [
	...new Set(
		Object.values(envelope.activeByDevice).flatMap(
			(selection) =>
				envelope.profiles
					.find((p) => p.id === selection.profileId)
					?.pages.find((p) => p.id === selection.pageId)
					?.keys.filter((k) => k.config.display)
					.flatMap((k) => {
						const ha = keyHaConfig(k);
						return ha && ha.custom_display_type !== "icon"
							? [ha.entity_id]
							: [];
					}) ?? [],
		),
	),
];
const baseConfig = (
	text: string,
	type: string,
	actions: ProfileKey["config"]["actions"],
) => ({
	type,
	title: {
		text,
		pos: "bot",
		size: 8,
		color: "#FFFFFF",
		display: true,
		style: "bold|italic|underline",
	},
	size: [1, 1],
	display: true,
	supportKnob: false,
	icon: "0-1",
	actions,
});
export function integrationProfiles<R>(
	runtime: DesktopRuntime<R | ProfileService | ProfileRepository, never>,
) {
	return {
		targets: (): Promise<readonly KeyTarget[]> =>
			runtime.runPromise(
				ProfileService.loadProfiles().pipe(
					Effect.map(({ envelope }) =>
						envelope.profiles
							.filter((p) => !/^\d+-/.test(p.id))
							.flatMap((p) =>
								p.pages.flatMap((page) =>
									Array.from({ length: 16 }, (_, index) => {
										const keyCode = `${Math.floor(index / 8) + 1},${(index % 8) + 1}`;
										const key = page.keys.find((k) => k.keyCode === keyCode);
										return {
											profileId: p.id,
											pageId: page.id,
											keyCode,
											label: `${p.name} / ${page.id} / ${keyCode}${key?.config.title.text ? ` · ${key.config.title.text}` : ""}`,
											key: key ? keyHaConfig(key) : null,
										};
									}),
								),
							),
					),
				),
			),
		sync: (library: ShortcutLibrary): Promise<string> =>
			runtime.runPromise(
				Effect.gen(function* () {
					if (
						!library.rows.length ||
						weightedNameLength(library.name.trim()) > 10
					)
						return yield* Effect.fail(
							new InputRejected(
								undefined,
								"Profile name must contain at most 10 characters",
							),
						);
					const id = `shortcuts-${library.id}`;
					const repository = yield* ProfileRepository;
					yield* repository.transact((current) =>
						Effect.gen(function* () {
							const old = current.profiles.find((p) => p.id === id);
							if (!old && visibleProfiles(current).length >= PROFILE_LIMIT)
								return yield* Effect.fail(
									new InputRejected(undefined, "Profile capacity"),
								);
							const pages = Array.from(
								{ length: Math.ceil(library.rows.length / 16) },
								(_, page) => ({
									id: `${id}-${page + 1}`,
									keys: library.rows
										.slice(page * 16, page * 16 + 16)
										.map((row, index) => ({
											keyCode: `${Math.floor(index / 8) + 1},${(index % 8) + 1}`,
											childrenName: row.config?.type ?? "hotkey",
											config: {
												...baseConfig(
													row.name,
													row.config?.type ?? "hotkey",
													row.config?.actions ?? [
														{ type: "key", value: executableChord(row.chord) },
													],
												),
												...(row.icon ? { icon: row.icon } : {}),
											},
										})),
								}),
							);
							const profile = yield* Schema.decodeUnknown(Profile)({
								id,
								name: library.name,
								revision: (old?.revision ?? -1) + 1,
								pages,
							}).pipe(
								Effect.catchTag("ParseError", (c) =>
									Effect.fail(new ProfilePlacementFailed(c)),
								),
							);
							const candidate: ProfileEnvelope = {
								...current,
								profiles: [
									current.profiles[0],
									...current.profiles.slice(1).filter((p) => p.id !== id),
								],
							};
							const profiles = old
								? current.profiles.map((p) => (p.id === id ? profile : p))
								: [...candidate.profiles, profile];
							const next = yield* Schema.validate(ProfileEnvelope)({
								...current,
								profiles,
								activeByDevice: Object.fromEntries(
									Object.entries(current.activeByDevice).map(
										([serial, selection]) => [
											serial,
											selection.profileId === id &&
											!profile.pages.some(
												(page) => page.id === selection.pageId,
											)
												? { ...selection, pageId: profile.pages[0].id }
												: selection,
										],
									),
								),
							}).pipe(
								Effect.catchTag("ParseError", (c) =>
									Effect.fail(new ProfilePlacementFailed(c)),
								),
							);
							const checked = applyManagerCommand(next, {
								type: "rename",
								id,
								name: library.name,
							});
							if (checked._tag === "rejected")
								return yield* Effect.fail(
									new InputRejected(undefined, `Profile ${checked.reason}`),
								);
							return next;
						}),
					);
					return id;
				}),
			),
		place: (target: HaTarget, config: HaKey): Promise<void> =>
			runtime.runPromise(
				Effect.gen(function* () {
					const repository = yield* ProfileRepository;
					yield* repository.transact((current) =>
						Effect.gen(function* () {
							const profile = current.profiles.find(
								(p) => p.id === target.profileId,
							);
							const page = profile?.pages.find((p) => p.id === target.pageId);
							if (!profile || !page || /^\d+-/.test(profile.id))
								return yield* Effect.fail(
									new InputRejected(undefined, "profile key"),
								);
							const previous = page.keys.find(
								(k) => k.keyCode === target.keyCode,
							);
							const key = yield* Schema.decodeUnknown(ProfileKey)({
								keyCode: target.keyCode,
								childrenName: "homeAssistant",
								config: {
									...baseConfig(config.entity_id, "homeAssistant", [
										{ type: "configData", value: JSON.stringify(config) },
									]),
									...(previous && previous.config.type !== ""
										? {
												title:
													Schema.encodeSync(ProfileKey)(previous).config.title,
												icon: previous.config.icon,
											}
										: { icon: "0-55" }),
								},
							}).pipe(
								Effect.catchTag("ParseError", (c) =>
									Effect.fail(new ProfilePlacementFailed(c)),
								),
							);
							const updated = {
								...profile,
								revision: profile.revision + 1,
								pages: EffectArray.map(profile.pages, (p) =>
									p.id === page.id
										? {
												...p,
												keys: [
													...p.keys.filter((k) => k.keyCode !== target.keyCode),
													key,
												],
											}
										: p,
								),
							};
							return {
								...current,
								profiles: [
									current.profiles[0].id === updated.id
										? updated
										: current.profiles[0],
									...current.profiles
										.slice(1)
										.map((p) => (p.id === updated.id ? updated : p)),
								],
							};
						}),
					);
				}),
			),
	};
}
