import { Context, Effect, Option } from "effect";
import type {
	EmojiApp,
	EmojiCommand,
	EmojiKeyReference,
	EmojiMode,
	EmojiStore,
} from "./emoji-contracts";
import {
	EmojiClipboardFailed,
	type EmojiForegroundFailed,
	EmojiInvalid,
	type EmojiKeyboardFailed,
	type EmojiLibraryFailed,
} from "./emoji-errors";
import { applyEmojiCommand, emojiCommandRejection } from "./emoji-invariants";
import { EmojiRepository } from "./emoji-repository";
export interface EmojiPressPorts {
	readonly platform: "darwin" | "win32" | "linux";
	readonly foreground: () => Effect.Effect<
		Option.Option<EmojiApp>,
		EmojiForegroundFailed
	>;
	readonly copyGif: (hash: string) => Effect.Effect<void, EmojiClipboardFailed>;
	readonly keyboard: (
		chord: string,
	) => Effect.Effect<void, EmojiKeyboardFailed>;
}
export class EmojiPressAdapters extends Context.Tag(
	"@open-quake/EmojiPressAdapters",
)<EmojiPressAdapters, EmojiPressPorts>() {}
export class EmojiLibrary extends Effect.Service<EmojiLibrary>()(
	"@open-quake/EmojiLibrary",
	{
		accessors: true,
		dependencies: [EmojiRepository.Default],
		effect: Effect.gen(function* () {
			const repository = yield* EmojiRepository;
			const command = Effect.fn("EmojiLibrary.command")(
				(
					input: EmojiCommand,
				): Effect.Effect<EmojiStore, EmojiInvalid | EmojiLibraryFailed> =>
					repository.transact((state) => {
						const reason = emojiCommandRejection(state, input);
						return reason
							? Effect.fail(new EmojiInvalid(reason))
							: Effect.succeed(applyEmojiCommand(state, input));
					}),
			);
			return { read: repository.read, command };
		}),
	},
) {}
export class EmojiPress extends Effect.Service<EmojiPress>()(
	"@open-quake/EmojiPress",
	{
		accessors: true,
		dependencies: [EmojiRepository.Default],
		effect: Effect.gen(function* () {
			const repo = yield* EmojiRepository;
			const adapters = yield* EmojiPressAdapters;
			const mutex = yield* Effect.makeSemaphore(1);
			const press = Effect.fn("EmojiPress.press")(function* (
				ref: EmojiKeyReference,
				keyMode: EmojiMode,
				action: number,
			): Effect.fn.Return<
				"ignored" | "copied",
				| EmojiLibraryFailed
				| EmojiInvalid
				| EmojiForegroundFailed
				| EmojiClipboardFailed
				| EmojiKeyboardFailed
			> {
				if (action !== 1) return "ignored";
				return yield* Effect.gen(function* () {
					const state = yield* repo.read();
					// Placed assets remain valid after removal from a package. Immutable hashes pin saved keys.
					const item = state.items.find((item) => item.id === ref.emojiId);
					if (!item)
						return yield* new EmojiInvalid("The emoji asset is missing.");
					if (state.appMatch && state.apps.length > 0) {
						const app = yield* adapters.foreground();
						if (
							Option.isNone(app) ||
							!state.apps.some(
								(allowed) =>
									(allowed.identifier !== "" &&
										allowed.identifier === app.value.identifier) ||
									allowed.path.toLowerCase() === app.value.path.toLowerCase(),
							)
						)
							return "ignored";
					}
					if (adapters.platform === "linux")
						return yield* new EmojiClipboardFailed(undefined);
					yield* adapters.copyGif(ref.hash);
					const mode = state.globalMode ?? keyMode;
					if (mode > 0) {
						yield* Effect.sleep("100 millis");
						yield* adapters.keyboard(
							adapters.platform === "darwin" ? "command+v" : "control+v",
						);
						if (mode === 2) {
							yield* Effect.sleep("100 millis");
							yield* adapters.keyboard("enter");
						}
					}
					return "copied";
				}).pipe(mutex.withPermits(1));
			});
			return { press };
		}),
	},
) {}
