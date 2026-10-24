import {
	Effect,
	Array as EffectArray,
	type ManagedRuntime,
	Option,
	Schema,
} from "effect";
import {
	Profile,
	type ProfileEnvelope,
	ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts";
import {
	managerState,
	visibleProfiles,
	weightedNameLength,
} from "../../../../../packages/device/src/profiles/profile-manager-invariants";
import { ProfileRepository } from "../../../../../packages/device/src/profiles/profile-repository";
import type { EmojiStore } from "../../../../../packages/edge/src/emoji/emoji-contracts";
import { EmojiInvalid } from "../../../../../packages/edge/src/emoji/emoji-errors";

export const placeEmojiPackage =
	<R>(profiles: {
		readonly runtime: ManagedRuntime.ManagedRuntime<
			R | ProfileRepository,
			never
		>;
		readonly select: (id: string) => Promise<unknown>;
	}) =>
	async (packId: string, state: EmojiStore): Promise<string> => {
		const pack = state.packages.find((p) => p.id === packId);
		if (!pack || pack.emojiIds.length === 0)
			throw new EmojiInvalid("The package is empty.");
		const profileId = pack.profileId ?? `emoji-${pack.id}`;
		let before: ProfileEnvelope | undefined;
		let writtenRevision = -1;
		await profiles.runtime.runPromise(
			Effect.gen(function* () {
				const repository = yield* ProfileRepository;
				return yield* repository.transact((envelope) =>
					Effect.gen(function* () {
						before = envelope;
						const previous = envelope.profiles.find((p) => p.id === profileId);
						if (!previous && visibleProfiles(envelope).length >= 30)
							return yield* new EmojiInvalid(
								"The profile limit is 30. Remove a profile first.",
							);
						if (
							weightedNameLength(pack.name) > 10 ||
							envelope.profiles.some(
								(p) => p.id !== profileId && p.name === pack.name,
							)
						)
							return yield* new EmojiInvalid(
								"Use a unique package name of at most 10 weighted units before adding it to the screen.",
							);
						const keys: ProfileKey[] = [];
						for (const [i, id] of pack.emojiIds.entries()) {
							const item = state.items.find((item) => item.id === id);
							if (!item)
								return yield* new EmojiInvalid("An emoji asset is missing.");
							keys.push(
								Schema.decodeUnknownSync(ProfileKey)({
									keyCode: `${Math.floor(i / 8) + 1},${(i % 8) + 1}`,
									childrenName: "emoji",
									config: {
										type: "emoji",
										display: true,
										size: [1, 1],
										supportKnob: false,
										supportTouchEffect: true,
										icon: `emoji:${item.rendered}`,
										title: {
											text: item.name,
											pos: "bot",
											size: 8,
											color: "#ffffff",
											display: item.name !== "",
											style: "bold",
										},
										actions: [
											{ type: "emojiAction", value: 1 },
											{
												type: "emojiConfig",
												value: {
													packageId: pack.id,
													emojiId: item.id,
													hash: item.rendered,
												},
											},
										],
									},
								}),
							);
						}
						const profile = yield* Schema.decodeUnknown(Profile)({
							id: profileId,
							name: pack.name,
							revision: (previous?.revision ?? -1) + 1,
							pages: [
								{
									id: `${profileId}-page`,
									keys: keys.map((key) => Schema.encodeSync(ProfileKey)(key)),
								},
							],
						}).pipe(
							Effect.catchTag("ParseError", () =>
								Effect.fail(
									new EmojiInvalid("The package contains an invalid key."),
								),
							),
						);
						writtenRevision = profile.revision;
						const manager = managerState(envelope);
						const updatedProfiles: readonly [Profile, ...Profile[]] = previous
							? [
									envelope.profiles[0].id === profileId
										? profile
										: envelope.profiles[0],
									...envelope.profiles
										.slice(1)
										.map((p) => (p.id === profileId ? profile : p)),
								]
							: [envelope.profiles[0], ...envelope.profiles.slice(1), profile];
						return {
							...envelope,
							profiles: updatedProfiles,
							manager: Option.some({
								...manager,
								revision: manager.revision + 1,
							}),
						};
					}),
				);
			}),
		);
		try {
			await profiles.select(profileId);
		} catch (cause) {
			const previous = before;
			if (previous)
				await profiles.runtime.runPromise(
					Effect.gen(function* () {
						const repository = yield* ProfileRepository;
						yield* repository.transact((current) => {
							const placed = current.profiles.find((p) => p.id === profileId);
							if (placed?.revision !== writtenRevision)
								return Effect.fail(
									new EmojiInvalid(
										"Activation failed. The profile changed during rollback; review it in Knob Profile.",
									),
								);
							const original = previous.profiles.find(
								(p) => p.id === profileId,
							);
							const remaining = original
								? EffectArray.map(current.profiles, (p) =>
										p.id === profileId ? original : p,
									)
								: current.profiles.filter((p) => p.id !== profileId);
							const first = remaining[0];
							if (!first)
								return Effect.fail(
									new EmojiInvalid("Profile rollback failed."),
								);
							return Effect.succeed({
								...current,
								profiles: [first, ...remaining.slice(1)],
								activeByDevice: Object.fromEntries(
									Object.entries(current.activeByDevice).map(
										([serial, selection]) => [
											serial,
											selection.profileId === profileId
												? (previous.activeByDevice[serial] ?? {
														profileId: first.id,
														pageId: first.pages[0].id,
													})
												: selection,
										],
									),
								),
								manager: Option.some({
									...managerState(current),
									revision: managerState(current).revision + 1,
									anchor: managerState(previous).anchor,
								}),
							});
						});
					}),
				);
			throw cause;
		}
		return profileId;
	};
