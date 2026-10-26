import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Stream } from "effect";
import { AiConnectivity } from "./ai-connectivity.js";
import type { NormalizedEvent } from "./ai-contracts.js";
import { AiRepository } from "./ai-repository.js";
import { AiProviderService } from "./ai-service.js";
import {
	workflowLayer,
	workflowProfile,
	workflowRequest,
} from "./ai-test-fixtures.js";

describe("provider terminal and offline defense", () => {
	for (const text of ["", " \t\n", "answer"])
		it.effect(`AI-093 terminal text ${JSON.stringify(text)}`, () =>
			Effect.gen(function* () {
				yield* AiRepository.put(workflowProfile);
				const generation = yield* AiProviderService.generate(workflowRequest);
				expect(
					yield* Effect.either(Stream.runCollect(generation.events)),
				).toMatchObject(
					text.trim()
						? { _tag: "Right" }
						: { _tag: "Left", left: { code: "AI.PROVIDER.PROTOCOL_INVALID" } },
				);
			}).pipe(
				Effect.provide(
					workflowLayer({
						open: () =>
							Effect.succeed(
								Stream.fromIterable<NormalizedEvent>([
									{ _tag: "textDelta", textDelta: text, kind: "generation" },
									{ _tag: "completed" },
								]),
							),
					}),
				),
			),
		);
	it.effect(
		"AI-020 offline blocks credentials and transport, reconnection permits exactly one request",
		() => {
			let online = false;
			let calls = 0;
			let credentials = 0;
			return Effect.gen(function* () {
				yield* AiRepository.put(workflowProfile);
				const first = yield* AiProviderService.generate(workflowRequest);
				expect(
					yield* Effect.either(Stream.runDrain(first.events)),
				).toMatchObject({
					_tag: "Left",
					left: { code: "AI.PROVIDER.OFFLINE" },
				});
				expect([calls, credentials]).toEqual([0, 0]);
				online = true;
				const second = yield* AiProviderService.generate(workflowRequest);
				yield* Stream.runDrain(second.events);
				expect([calls, credentials]).toEqual([1, 1]);
				const cancelled = yield* AiProviderService.generate(workflowRequest);
				yield* cancelled.cancel();
				yield* Stream.runDrain(cancelled.events);
				expect([calls, credentials]).toEqual([1, 1]);
			}).pipe(
				Effect.provide(
					workflowLayer(
						{
							open: () => {
								calls++;
								return Effect.succeed(
									Stream.fromIterable<NormalizedEvent>([
										{
											_tag: "textDelta",
											textDelta: "answer",
											kind: "generation",
										},
										{ _tag: "completed" },
									]),
								);
							},
						},
						{
							resolve: () => {
								credentials++;
								return Effect.succeed(importRedacted());
							},
							revoked: () => Effect.never,
						},
					).pipe(
						Layer.provide(
							Layer.succeed(AiConnectivity, {
								online: () => Effect.sync(() => online),
							}),
						),
					),
				),
			);
		},
	);
});

import { Redacted } from "effect";

const importRedacted = () => Redacted.make("fixture");
