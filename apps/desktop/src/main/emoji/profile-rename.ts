import { Effect, Array as EffectArray, Option } from "effect";
import type { Profile } from "../../../../../packages/device/src/profiles/profile-contracts";
import {
	managerState,
	weightedNameLength,
} from "../../../../../packages/device/src/profiles/profile-manager-invariants";
import { ProfileRepository } from "../../../../../packages/device/src/profiles/profile-repository";
import { EmojiInvalid } from "../../../../../packages/edge/src/emoji/emoji-errors";
import type { DesktopRuntime } from "../diagnostics/module";
export const renameLinkedEmojiProfile =
	<R>(profiles: {
		readonly runtime: DesktopRuntime<R | ProfileRepository, never>;
		readonly refresh?: () => Promise<void>;
	}) =>
	async (
		id: string,
		name: string,
		saveLibrary: () => Promise<void>,
	): Promise<void> => {
		let before: Profile | undefined;
		await profiles.runtime.runPromise(
			Effect.gen(function* () {
				const repo = yield* ProfileRepository;
				yield* repo.transact((current) =>
					Effect.gen(function* () {
						before = current.profiles.find((p) => p.id === id);
						if (!before)
							return yield* new EmojiInvalid("Linked emoji profile not found.");
						if (
							!name ||
							weightedNameLength(name) > 10 ||
							current.profiles.some((p) => p.id !== id && p.name === name)
						)
							return yield* new EmojiInvalid(
								"Use a unique profile name of at most 10 weighted units.",
							);
						return {
							...current,
							profiles: EffectArray.map(current.profiles, (p) =>
								p.id === id ? { ...p, name, revision: p.revision + 1 } : p,
							),
							manager: Option.some({
								...managerState(current),
								revision: managerState(current).revision + 1,
							}),
						};
					}),
				);
			}),
		);
		try {
			await saveLibrary();
		} catch (cause) {
			const previous = before;
			if (previous)
				await profiles.runtime.runPromise(
					Effect.gen(function* () {
						const repo = yield* ProfileRepository;
						yield* repo.transact((current) => {
							const renamed = current.profiles.find((p) => p.id === id);
							if (renamed?.revision !== previous.revision + 1)
								return Effect.fail(
									new EmojiInvalid(
										"The profile changed during rename rollback. Review it before retrying.",
									),
								);
							return Effect.succeed({
								...current,
								profiles: EffectArray.map(current.profiles, (p) =>
									p.id === id ? { ...previous, revision: p.revision + 1 } : p,
								),
								manager: Option.some({
									...managerState(current),
									revision: managerState(current).revision + 1,
								}),
							});
						});
					}),
				);
			throw cause;
		}
		await profiles.refresh?.();
	};
