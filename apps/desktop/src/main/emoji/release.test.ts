import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { expect, it } from "vitest";
import { emptyEmojiStore } from "../../../../../packages/edge/src/emoji/emoji-contracts";
import {
	EmojiRepository,
	emojiStorageLayer,
} from "../../../../../packages/edge/src/emoji/emoji-repository";
import {
	EmojiPress,
	EmojiPressAdapters,
} from "../../../../../packages/edge/src/emoji/emoji-service";
import { createStripTouchController } from "../../renderer/src/strip/touch-controller";

for (const mode of [0, 1, 2] as const) {
	it(`WIDGETS-106: strip release reaches EmojiPress in mode ${mode}, down and hold stay inert`, async () => {
		const hash = "a".repeat(64);
		const calls: string[] = [];
		const runtime = ManagedRuntime.make(
			EmojiPress.DefaultWithoutDependencies.pipe(
				Layer.provide(
					EmojiRepository.Default.pipe(
						Layer.provide(
							emojiStorageLayer({
								read: async () => ({
									...emptyEmojiStore,
									globalMode: null,
									appMatch: false,
									items: [
										{
											id: "e",
											name: "Smile",
											original: hash,
											rendered: hash,
											caption: {
												text: "",
												size: 48,
												color: "0xffffffff",
												position: "bot",
											},
										},
									],
								}),
								write: async () => {},
							}),
						),
					),
				),
				Layer.provide(
					Layer.succeed(EmojiPressAdapters, {
						platform: "darwin",
						foreground: () => Effect.succeed(Option.none()),
						copyGif: () =>
							Effect.sync(() => {
								calls.push("copy");
							}),
						keyboard: (chord) =>
							Effect.sync(() => {
								calls.push(chord);
							}),
					}),
				),
			),
		);
		const requests: Promise<unknown>[] = [];
		const scheduled: (() => void)[] = [];
		const controller = createStripTouchController({
			view: () => ({ width: 1920, height: 480, rotation: 0 }),
			layout: () => 0,
			tileAt: () => ({ keyCode: "1,1", supportTouchEffect: true }),
			onKey: (event) => {
				requests.push(
					runtime.runPromise(
						EmojiPress.press(
							{ packageId: "p", emojiId: "e", hash },
							mode,
							event.keyAction,
						),
					),
				);
			},
			onSubTouch: () => {},
			overlay: { active: () => false, point: () => {} },
			now: () => 0,
			schedule: (action) => {
				scheduled.push(action);
				return () => {};
			},
		});
		const touch = (action: number) =>
			controller.event({
				source: "mock",
				kind: "touch",
				points: [{ x: 20, y: 460, action }],
			});
		try {
			touch(1);
			touch(1);
			await Promise.all(requests);
			expect(calls).toEqual([]);
			touch(0);
			for (const release of scheduled.splice(0)) release();
			await Promise.all(requests);
			expect(calls).toEqual([
				"copy",
				...(mode > 0 ? ["command+v"] : []),
				...(mode === 2 ? ["enter"] : []),
			]);
		} finally {
			controller.dispose();
			await runtime.dispose();
		}
	});
}
