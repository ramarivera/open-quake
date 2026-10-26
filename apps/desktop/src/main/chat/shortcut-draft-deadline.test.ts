import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Option, Stream, TestClock } from "effect";
import type { ModelRow } from "../../../../../packages/edge/src/agents/agents-contracts";
import { ChatInference } from "../../../../../packages/edge/src/chat/chat-ports";
import { profileFromModel } from "./host";
import { shortcutDraft } from "./shortcut-draft";

it.effect(
	"ends a blocked generation at exactly 60 seconds and cancels its provider",
	() =>
		Effect.gen(function* () {
			const opened = yield* Deferred.make<void>();
			let cancelled = false;
			const row: ModelRow = {
				id: "saved",
				role: "default",
				provider: "generic",
				model: "fixture",
				baseUrl: "https://example.invalid/v1",
				maxTokens: 512,
				credentialRef: "00000000-0000-4000-8000-000000000001",
			};
			const fiber = yield* shortcutDraft(
				"Editor：copy",
				() => Effect.succeed([row]),
				profileFromModel,
			).pipe(
				Effect.provideService(ChatInference, {
					open: () =>
						Effect.succeed({
							events: Stream.fromEffect(
								Deferred.succeed(opened, undefined),
							).pipe(Stream.drain, Stream.concat(Stream.never)),
							cancel: () =>
								Effect.sync(() => {
									cancelled = true;
								}),
						}),
				}),
				Effect.either,
				Effect.fork,
			);
			yield* Deferred.await(opened);
			yield* TestClock.adjust("59999 millis");
			expect(Option.isNone(yield* Fiber.poll(fiber))).toBe(true);
			yield* TestClock.adjust("1 millis");
			expect(yield* Fiber.join(fiber)).toMatchObject({
				_tag: "Left",
				left: { code: "AI.PROVIDER.UNAVAILABLE" },
			});
			expect(cancelled).toBe(true);
		}),
);
