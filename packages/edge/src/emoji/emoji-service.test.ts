import { it } from "@effect/vitest";
import { Effect, Fiber, Layer, Option, TestClock } from "effect";
import { describe, expect } from "vitest";
import { type EmojiStore, emptyEmojiStore } from "./emoji-contracts";
import { EmojiClipboardFailed, EmojiKeyboardFailed } from "./emoji-errors";
import {
	applyEmojiCommand,
	emojiCommandRejection,
	weightedLength,
} from "./emoji-invariants";
import { EmojiRepository, emojiStorageLayer } from "./emoji-repository";
import {
	EmojiLibrary,
	EmojiPress,
	EmojiPressAdapters,
	type EmojiPressPorts,
} from "./emoji-service";

const hash = "a".repeat(64);
const item = {
	id: "wave",
	name: "Wave",
	original: hash,
	rendered: hash,
	caption: { text: "", size: 48, color: "0xffffffff", position: "bot" },
} as const;
const initial: EmojiStore = {
	...emptyEmojiStore,
	items: [item],
	drafts: [item.id],
};
const ref = { packageId: "pack", emojiId: "wave", hash };
function setup(
	state: EmojiStore = initial,
	options: {
		copyFails?: boolean;
		keyboardFails?: boolean;
		writeFails?: boolean;
		foreground?: string;
	} = {},
) {
	let saved = state;
	const calls: string[] = [];
	const ports: EmojiPressPorts = {
		platform: "darwin",
		foreground: () =>
			Effect.succeed(
				Option.some({
					name: "Finder",
					path: options.foreground ?? "/System/Library/CoreServices/Finder.app",
					identifier: "com.apple.finder",
				}),
			),
		copyGif: (hash) => {
			calls.push(`copy:${hash}`);
			return options.copyFails
				? Effect.fail(new EmojiClipboardFailed({ secret: "private" }))
				: Effect.void;
		},
		keyboard: (chord) => {
			calls.push(chord);
			return options.keyboardFails
				? Effect.fail(new EmojiKeyboardFailed(undefined))
				: Effect.void;
		},
	};
	const repo = EmojiRepository.Default.pipe(
		Layer.provide(
			emojiStorageLayer({
				read: async () => saved,
				write: async (value) => {
					if (options.writeFails) throw new Error("disk full");
					saved = value;
				},
			}),
		),
	);
	const layer = Layer.mergeAll(
		EmojiLibrary.DefaultWithoutDependencies,
		EmojiPress.DefaultWithoutDependencies,
	).pipe(
		Layer.provideMerge(repo),
		Layer.provide(Layer.succeed(EmojiPressAdapters, ports)),
	);
	return { layer, calls, saved: () => saved };
}
describe("Emoji release consumer", () => {
	it.effect(
		"copies, waits 100 ms, pastes, then waits another 100 ms before Enter",
		() => {
			const test = setup({ ...initial, globalMode: 2 });
			return Effect.gen(function* () {
				yield* EmojiLibrary.read();
				const fiber = yield* Effect.fork(EmojiPress.press(ref, 0, 1));
				yield* Effect.yieldNow();
				expect(test.calls).toEqual([`copy:${hash}`]);
				yield* TestClock.adjust("99 millis");
				expect(test.calls).toHaveLength(1);
				yield* TestClock.adjust("1 millis");
				expect(test.calls).toEqual([`copy:${hash}`, "command+v"]);
				yield* TestClock.adjust("100 millis");
				expect(yield* Fiber.join(fiber)).toBe("copied");
				expect(test.calls).toEqual([`copy:${hash}`, "command+v", "enter"]);
			}).pipe(Effect.provide(test.layer));
		},
	);
	it.effect(
		"foreground mismatch touches neither clipboard nor keyboard",
		() => {
			const test = setup({
				...initial,
				apps: [
					{
						name: "Slack",
						path: "/Applications/Slack.app",
						identifier: "com.tinyspeck.slackmacgap",
					},
				],
			});
			return Effect.gen(function* () {
				expect(yield* EmojiPress.press(ref, 2, 1)).toBe("ignored");
				expect(test.calls).toEqual([]);
			}).pipe(Effect.provide(test.layer));
		},
	);
	it.effect("press-down and hold never trigger actions", () => {
		const test = setup();
		return Effect.gen(function* () {
			expect(yield* EmojiPress.press(ref, 2, 0)).toBe("ignored");
			expect(yield* EmojiPress.press(ref, 2, 2)).toBe("ignored");
			expect(test.calls).toEqual([]);
		}).pipe(Effect.provide(test.layer));
	});
	it.effect(
		"a failed clipboard write sends no key and exposes no cause",
		() => {
			const test = setup(initial, { copyFails: true });
			return Effect.gen(function* () {
				const result = yield* Effect.flip(EmojiPress.press(ref, 2, 1));
				expect(result._tag).toBe("EmojiClipboardFailed");
				expect(JSON.stringify(result)).not.toContain("private");
				expect(test.calls).toEqual([`copy:${hash}`]);
			}).pipe(Effect.provide(test.layer));
		},
	);
	it.effect("copy-only mode bypasses the device keyboard", () => {
		const test = setup({ ...initial, globalMode: 0 }, { keyboardFails: true });
		return Effect.gen(function* () {
			expect(yield* EmojiPress.press(ref, 2, 1)).toBe("copied");
			expect(test.calls).toEqual([`copy:${hash}`]);
		}).pipe(Effect.provide(test.layer));
	});
	it.effect("a missing asset stops before clipboard and keyboard", () => {
		const test = setup({ ...initial, items: [] });
		return Effect.gen(function* () {
			expect((yield* Effect.flip(EmojiPress.press(ref, 2, 1)))._tag).toBe(
				"EmojiInvalid",
			);
			expect(test.calls).toEqual([]);
		}).pipe(Effect.provide(test.layer));
	});
	it.effect(
		"failed persistence leaves both cached and committed libraries unchanged",
		() => {
			const test = setup(initial, { writeFails: true });
			return Effect.gen(function* () {
				const error = yield* Effect.flip(
					EmojiLibrary.command({
						type: "create-package",
						id: "pack",
						name: "Hello",
					}),
				);
				expect(error._tag).toBe("EmojiLibraryFailed");
				expect(yield* EmojiLibrary.read()).toEqual(initial);
				expect(test.saved()).toEqual(initial);
			}).pipe(Effect.provide(test.layer));
		},
	);
	it.effect(
		"an emoji removed from its pack keeps working from its saved hash",
		() => {
			const test = setup({ ...initial, drafts: [], globalMode: 0 });
			return Effect.gen(function* () {
				expect(yield* EmojiPress.press(ref, 1, 1)).toBe("copied");
			}).pipe(Effect.provide(test.layer));
		},
	);
});
describe("Emoji package invariants", () => {
	it("counts CJK units and validates package capacity without losing drafts", () => {
		expect(weightedLength("你好A")).toBe(5);
		expect(
			emojiCommandRejection(initial, {
				type: "create-package",
				id: "p",
				name: "好".repeat(11),
			}),
		).toContain("20");
		const full = {
			...initial,
			packages: [
				{
					id: "p",
					name: "Pack",
					emojiIds: Array.from({ length: 16 }, (_, i) => `id${i}`),
					profileId: null,
				},
			],
		};
		expect(
			emojiCommandRejection(full, {
				type: "add-drafts",
				packageId: "p",
				ids: ["wave"],
			}),
		).toContain("full");
		expect(full.drafts).toEqual(["wave"]);
	});
	it("deduplicates apps by path or identifier and adds each draft only once", () => {
		const store = applyEmojiCommand(initial, {
			type: "settings",
			globalMode: 1,
			appMatch: true,
			apps: [
				{ name: "Slack", path: "/Applications/Slack.app", identifier: "slack" },
				{ name: "Slack copy", path: "/Other/Slack.app", identifier: "slack" },
			],
		});
		expect(store.apps).toHaveLength(1);
		const pack = applyEmojiCommand(initial, {
			type: "create-package",
			id: "p",
			name: " ",
		});
		expect(pack.packages[0]?.name).toBe("Unnamed Pack");
		expect(
			applyEmojiCommand(pack, {
				type: "add-drafts",
				packageId: "p",
				ids: ["wave", "wave"],
			}).packages[0]?.emojiIds,
		).toEqual(["wave"]);
	});
});

it("leaves a deleted grid slot vacant and fills it before appending", () => {
	const store = {
		...initial,
		packages: [
			{
				id: "p",
				name: "Pack",
				emojiIds: ["first", "middle", "last"],
				profileId: null,
			},
		],
	};
	const removed = applyEmojiCommand(store, {
		type: "remove-emoji",
		packageId: "p",
		id: "middle",
	});
	expect(removed.packages[0]?.emojiIds).toEqual(["first", "", "last"]);
	expect(
		emojiCommandRejection(removed, {
			type: "add-drafts",
			packageId: "p",
			ids: ["wave"],
		}),
	).toBeNull();
	const added = applyEmojiCommand(removed, {
		type: "add-drafts",
		packageId: "p",
		ids: ["wave", "wave"],
	});
	expect(added.packages[0]?.emojiIds).toEqual(["first", "wave", "last"]);
	const fullSlots = {
		...removed,
		packages: removed.packages.map((pack) => ({
			...pack,
			emojiIds: Array.from({ length: 16 }, (_, i) =>
				i === 5 ? "" : `occupied-${i}`,
			),
		})),
	};
	expect(
		emojiCommandRejection(fullSlots, {
			type: "add-drafts",
			packageId: "p",
			ids: ["wave"],
		}),
	).toBeNull();
	expect(
		applyEmojiCommand(fullSlots, {
			type: "add-drafts",
			packageId: "p",
			ids: ["wave"],
		}).packages[0]?.emojiIds[5],
	).toBe("wave");
});

for (const mode of [0, 1, 2] as const) {
	it.effect(
		`uses key mode ${mode} only on release when global mode is null`,
		() => {
			const f = setup({ ...initial, globalMode: null, appMatch: false });
			return Effect.gen(function* () {
				expect(yield* EmojiPress.press(ref, mode, 0)).toBe("ignored");
				expect(yield* EmojiPress.press(ref, mode, 2)).toBe("ignored");
				expect(f.calls).toEqual([]);
				const release = yield* Effect.fork(EmojiPress.press(ref, mode, 1));
				yield* TestClock.adjust("200 millis");
				yield* Fiber.join(release);
				expect(f.calls).toEqual([
					`copy:${hash}`,
					...(mode > 0 ? ["command+v"] : []),
					...(mode === 2 ? ["enter"] : []),
				]);
			}).pipe(Effect.provide(f.layer));
		},
	);
}
