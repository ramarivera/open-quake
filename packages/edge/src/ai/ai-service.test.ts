import { describe, expect, it } from "@effect/vitest";
import {
	Chunk,
	ConfigProvider,
	Deferred,
	Effect,
	Either,
	Fiber,
	Layer,
	Redacted,
	Ref,
	Schema,
	Stream,
	TestClock,
} from "effect";
import {
	AiCompatibleAdapter,
	type CompatibleAdapter,
} from "./adapters/adapter.js";
import {
	CredentialRef,
	type InferenceRequest,
	type NormalizedEvent,
	ProfileId,
	type ProviderProfile,
} from "./ai-contracts.js";
import { AiCredentials } from "./ai-credentials.js";
import {
	AiAuthRevoked,
	AiProtocolInvalid,
	AiRateLimited,
	translateProviderFailure,
} from "./ai-errors.js";
import { AiRepository, MOCK_PROFILE } from "./ai-repository.js";
import { AiProviderService } from "./ai-service.js";

const request: InferenceRequest = {
	profileId: MOCK_PROFILE.id,
	messages: [{ role: "user", content: [{ _tag: "text", text: "hello" }] }],
	requestedCapabilities: [],
	sampling: {},
};
const profile: ProviderProfile = {
	...MOCK_PROFILE,
	adapter: "openai-compatible",
	auth: "apiKey",
	credentialRef: Schema.decodeUnknownSync(CredentialRef)(
		"00000000-0000-4000-8000-000000000002",
	),
};
const config = (adapter: string) =>
	Layer.setConfigProvider(
		ConfigProvider.fromMap(new Map([["AI_PROVIDER_ADAPTER", adapter]])),
	);
const mockLayer = AiProviderService.DefaultWithoutDependencies.pipe(
	Layer.provideMerge(AiRepository.Default),
	Layer.provide(Layer.setConfigProvider(ConfigProvider.fromMap(new Map()))),
);
const compatibleLayer = (
	adapter: CompatibleAdapter,
	credentials: typeof AiCredentials.Service,
) =>
	AiProviderService.DefaultWithoutDependencies.pipe(
		Layer.provideMerge(AiRepository.Default),
		Layer.provide(
			Layer.mergeAll(
				config("openai-compatible"),
				Layer.succeed(AiCompatibleAdapter, adapter),
				Layer.succeed(AiCredentials, credentials),
			),
		),
	);

describe("mock-default provider facade", () => {
	it.effect(
		"rejects invalid sampling before credentials or provider dispatch",
		() =>
			Effect.gen(function* () {
				const repository = yield* AiRepository;
				const service = yield* AiProviderService;
				const selected: ProviderProfile = {
					...profile,
					samplingLimits: {
						temperature: { min: 0, max: 2 },
						topP: { min: 0, max: 1 },
					},
				};
				yield* repository.put(selected);
				const invalidProfile = yield* Effect.either(
					repository.put({
						...selected,
						samplingLimits: { temperature: { min: -1, max: 3 } },
					}),
				);
				expect(invalidProfile).toMatchObject({
					_tag: "Left",
					left: { _tag: "AiConfigInvalid", code: "AI.PROVIDER.CONFIG_INVALID" },
				});
				for (const sampling of [
					{ temperature: -0.1 },
					{ temperature: 2.1 },
					{ topP: -0.1 },
					{ topP: 1.1 },
				]) {
					const result = yield* Effect.either(
						service.generate({ ...request, sampling }),
					);
					expect(result).toMatchObject({
						_tag: "Left",
						left: {
							_tag: "AiConfigInvalid",
							code: "AI.PROVIDER.CONFIG_INVALID",
						},
					});
				}
			}).pipe(
				Effect.provide(
					compatibleLayer(
						{ open: () => Effect.die("adapter must not run") },
						{
							resolve: () => Effect.die("credentials must not run"),
							revoked: () => Effect.never,
						},
					),
				),
			),
	);
	it.effect(
		"rejects mock image requests and false capability declarations before dispatch",
		() =>
			Effect.gen(function* () {
				const service = yield* AiProviderService;
				const saved = yield* Effect.either(
					(yield* AiRepository).put({
						...MOCK_PROFILE,
						capabilities: { ...MOCK_PROFILE.capabilities, images: "supported" },
					}),
				);
				expect(Either.isLeft(saved) && saved.left.code).toBe(
					"AI.PROVIDER.CONFIG_INVALID",
				);
				const generated = yield* Effect.either(
					service.generate({
						...request,
						messages: [
							{
								role: "user",
								content: [{ _tag: "image", url: "https://image.invalid" }],
							},
						],
					}),
				);
				expect(
					Either.isLeft(generated) && [
						generated.left._tag,
						generated.left.code,
						"capability" in generated.left && generated.left.capability,
					],
				).toEqual([
					"AiCapabilityUnsupported",
					"AI.PROVIDER.CAPABILITY_UNSUPPORTED",
					"images",
				]);
			}).pipe(Effect.provide(mockLayer)),
	);

	it.effect("dispatches mock and compatible profiles in one service", () => {
		const calls: Parameters<CompatibleAdapter["open"]>[0][] = [];
		const selected: ProviderProfile = {
			...profile,
			id: Schema.decodeUnknownSync(ProfileId)(
				"00000000-0000-4000-8000-000000000003",
			),
		};
		return Effect.gen(function* () {
			const service = yield* AiProviderService;
			yield* (yield* AiRepository).put(selected);
			const mock = yield* service.generate(request);
			const compatible = yield* service.generate({
				...request,
				profileId: selected.id,
			});
			const mockConsumer = yield* Stream.runCollect(mock.events).pipe(
				Effect.fork,
			);
			const compatibleEvents = yield* Stream.runCollect(compatible.events);
			yield* TestClock.adjust(40);
			const mockEvents = Chunk.toReadonlyArray(yield* Fiber.join(mockConsumer));
			expect(mockEvents).toContainEqual({
				_tag: "textDelta",
				textDelta: "Mock ",
				kind: "generation",
			});
			expect(mockEvents.at(-1)).toEqual({ _tag: "completed" });
			expect(Chunk.toReadonlyArray(compatibleEvents)).toEqual([
				{ _tag: "textDelta", textDelta: "Compatible.", kind: "generation" },
				{ _tag: "completed" },
			]);
			expect(calls.map((call) => call.profile.id)).toEqual([selected.id]);
		}).pipe(
			Effect.provide(
				compatibleLayer(
					{
						open: (input) => {
							calls.push(input);
							return Effect.succeed(
								Stream.fromIterable<NormalizedEvent>([
									{
										_tag: "textDelta",
										textDelta: "Compatible.",
										kind: "generation",
									},
									{ _tag: "completed" },
								]),
							);
						},
					},
					{
						resolve: () => Effect.succeed(Redacted.make(crypto.randomUUID())),
						revoked: () => Effect.never,
					},
				),
			),
		);
	});

	it.effect("streams deterministic generated text on the Effect clock", () =>
		Effect.gen(function* () {
			const service = yield* AiProviderService;
			const generation = yield* service.generate(request);
			const seen = yield* Ref.make<ReadonlyArray<NormalizedEvent>>([]);
			const consumer = yield* Stream.runForEach(generation.events, (event) =>
				Ref.update(seen, (all) => [...all, event]),
			).pipe(Effect.fork);
			yield* TestClock.adjust(9);
			expect(yield* Ref.get(seen)).toEqual([]);
			yield* TestClock.adjust(1);
			expect(yield* Ref.get(seen)).toEqual([
				{ _tag: "textDelta", textDelta: "Mock ", kind: "generation" },
			]);
			yield* TestClock.adjust(30);
			yield* Fiber.join(consumer);
			expect((yield* Ref.get(seen)).map((event) => event._tag)).toEqual([
				"textDelta",
				"textDelta",
				"usage",
				"completed",
			]);
			expect(
				Either.isLeft(
					yield* Effect.either(Stream.runCollect(generation.events)),
				),
			).toBe(true);
		}).pipe(Effect.provide(mockLayer)),
	);

	it.effect(
		"cancels before dispatch and midway through the stream without late output",
		() =>
			Effect.gen(function* () {
				const service = yield* AiProviderService;
				const before = yield* service.generate(request);
				yield* before.cancel();
				expect(Chunk.isEmpty(yield* Stream.runCollect(before.events))).toBe(
					true,
				);
				const active = yield* service.generate(request);
				const seen = yield* Ref.make<ReadonlyArray<NormalizedEvent>>([]);
				const consumer = yield* Stream.runForEach(active.events, (event) =>
					Ref.update(seen, (all) => [...all, event]),
				).pipe(Effect.fork);
				yield* TestClock.adjust(10);
				yield* active.cancel();
				yield* Fiber.join(consumer);
				yield* TestClock.adjust(100);
				expect(yield* Ref.get(seen)).toHaveLength(1);
			}).pipe(Effect.provide(mockLayer)),
	);

	it.effect(
		"rejects unsupported inputs before opening the selected adapter or resolving credentials",
		() =>
			Effect.gen(function* () {
				const service = yield* AiProviderService;
				yield* (yield* AiRepository).put(profile);
				const unsupported = yield* Effect.either(
					service.generate({ ...request, requestedCapabilities: ["images"] }),
				);
				expect(
					Either.isLeft(unsupported) && [
						unsupported.left._tag,
						unsupported.left.code,
						"capability" in unsupported.left && unsupported.left.capability,
					],
				).toEqual([
					"AiCapabilityUnsupported",
					"AI.PROVIDER.CAPABILITY_UNSUPPORTED",
					"images",
				]);
			}).pipe(
				Effect.provide(
					compatibleLayer(
						{ open: () => Effect.die("adapter must not run") },
						{
							resolve: () => Effect.die("credentials must not run"),
							revoked: () => Effect.never,
						},
					),
				),
			),
	);

	it.effect(
		"uses the selected profile's adapter, pins its profile, and aborts on cancellation",
		() => {
			const calls: Parameters<CompatibleAdapter["open"]>[0][] = [];
			return Effect.gen(function* () {
				const repository = yield* AiRepository;
				yield* repository.put(profile);
				const generation = yield* (yield* AiProviderService).generate(request);
				yield* repository.put({ ...profile, modelId: "changed-later" });
				const consumer = yield* Stream.runCollect(generation.events).pipe(
					Effect.fork,
				);
				yield* TestClock.adjust(10);
				expect(calls).toHaveLength(1);
				expect(calls[0]?.profile.modelId).toBe(profile.modelId);
				expect(calls[0]?.redirectPolicy).toBe("error");
				expect(calls[0]?.maxRetries).toBe(0);
				yield* generation.cancel();
				yield* Fiber.join(consumer);
				expect(calls[0]?.signal.aborted).toBe(true);
			}).pipe(
				Effect.provide(
					compatibleLayer(
						{
							open: (input) => {
								calls.push(input);
								return Effect.succeed(Stream.never);
							},
						},
						{
							resolve: () => Effect.succeed(Redacted.make(crypto.randomUUID())),
							revoked: () => Effect.never,
						},
					),
				),
			);
		},
	);

	it.effect("revocation interrupts provider setup and aborts its signal", () =>
		Effect.gen(function* () {
			const revoked = yield* Deferred.make<never, AiAuthRevoked>();
			const opened = yield* Deferred.make<AbortSignal>();
			const layer = compatibleLayer(
				{
					open: ({ signal }) =>
						Deferred.succeed(opened, signal).pipe(
							Effect.zipRight(Effect.never),
						),
				},
				{
					resolve: () => Effect.succeed(Redacted.make(crypto.randomUUID())),
					revoked: () => Deferred.await(revoked),
				},
			);
			yield* Effect.gen(function* () {
				yield* (yield* AiRepository).put(profile);
				const generation = yield* (yield* AiProviderService).generate(request);
				const consumer = yield* Stream.runCollect(generation.events).pipe(
					Effect.either,
					Effect.fork,
				);
				const signal = yield* Deferred.await(opened);
				yield* Deferred.fail(revoked, new AiAuthRevoked());
				const result = yield* Fiber.join(consumer);
				expect(Either.isLeft(result) && result.left.code).toBe(
					"AI.PROVIDER.AUTH_REVOKED",
				);
				expect(signal.aborted).toBe(true);
			}).pipe(Effect.provide(layer));
		}),
	);

	it.effect(
		"preserves partial output and a single safe rate-limit failure without retry",
		() => {
			let calls = 0;
			const original = new Error(crypto.randomUUID());
			const failure = translateProviderFailure(429, original);
			return Effect.gen(function* () {
				yield* (yield* AiRepository).put(profile);
				const generation = yield* (yield* AiProviderService).generate(request);
				const seen: NormalizedEvent[] = [];
				const result = yield* Effect.either(
					Stream.runForEach(generation.events, (event) =>
						Effect.sync(() => seen.push(event)),
					),
				);
				expect(seen).toHaveLength(1);
				expect(Either.isLeft(result) && result.left).toBe(failure);
				expect(failure).toBeInstanceOf(AiRateLimited);
				expect(failure.originalCause).toBe(original);
				expect(JSON.stringify(failure)).not.toContain(original.message);
				expect(calls).toBe(1);
			}).pipe(
				Effect.provide(
					compatibleLayer(
						{
							open: () => {
								calls++;
								return Effect.succeed(
									Stream.succeed<NormalizedEvent>({
										_tag: "textDelta",
										textDelta: "partial",
										kind: "generation",
									}).pipe(Stream.concat(Stream.fail(failure))),
								);
							},
						},
						{
							resolve: () => Effect.succeed(Redacted.make(crypto.randomUUID())),
							revoked: () => Effect.never,
						},
					),
				),
			);
		},
	);

	it.effect(
		"rejects malformed or unterminated streams and suppresses data after completion",
		() =>
			Effect.gen(function* () {
				const invalid = { _tag: "unexpected" } as unknown as NormalizedEvent;
				const cases: ReadonlyArray<
					readonly [Stream.Stream<NormalizedEvent>, boolean]
				> = [
					[Stream.empty, false],
					[Stream.succeed(invalid), false],
					[
						Stream.fromIterable<NormalizedEvent>([
							{ _tag: "completed" },
							{ _tag: "textDelta", textDelta: "late", kind: "generation" },
						]),
						true,
					],
					[
						Stream.fromIterable<NormalizedEvent>([
							{ _tag: "completed" },
							invalid,
						]),
						true,
					],
				];
				for (const [source, succeeds] of cases) {
					yield* Effect.gen(function* () {
						yield* (yield* AiRepository).put(profile);
						const generation = yield* (yield* AiProviderService).generate(
							request,
						);
						const result = yield* Effect.either(
							Stream.runCollect(generation.events),
						);
						expect(Either.isRight(result)).toBe(succeeds);
						if (Either.isLeft(result))
							expect(result.left).toBeInstanceOf(AiProtocolInvalid);
						else
							expect(Chunk.toReadonlyArray(result.right)).toEqual([
								{ _tag: "completed" },
							]);
					}).pipe(
						Effect.provide(
							compatibleLayer(
								{ open: () => Effect.succeed(source) },
								{
									resolve: () =>
										Effect.succeed(Redacted.make(crypto.randomUUID())),
									revoked: () => Effect.never,
								},
							),
						),
					);
				}
			}),
	);

	it.effect(
		"returns the typed unavailable error for unregistered compatible and Codex adapters",
		() =>
			Effect.gen(function* () {
				for (const candidate of [
					profile,
					{ ...MOCK_PROFILE, adapter: "codex", auth: "codexDevice" },
				] as const) {
					const repository = yield* AiRepository;
					yield* repository.put(candidate);
					const result = yield* Effect.either(
						(yield* AiProviderService).generate(request),
					);
					expect(
						Either.isLeft(result) && [result.left._tag, result.left.code],
					).toEqual(["AiUnavailable", "AI.PROVIDER.UNAVAILABLE"]);
				}
			}).pipe(
				Effect.provide(
					AiProviderService.DefaultWithoutDependencies.pipe(
						Layer.provideMerge(AiRepository.Default),
						Layer.provide(
							Layer.succeed(AiCredentials, {
								resolve: () =>
									Effect.die(
										"unregistered adapter must not resolve credentials",
									),
								revoked: () =>
									Effect.die("unregistered adapter must not watch credentials"),
							}),
						),
					),
				),
			),
	);

	it.effect(
		"requires credentials for a registered compatible adapter before dispatch",
		() =>
			Effect.gen(function* () {
				for (const credentialRef of [undefined, profile.credentialRef]) {
					const layer = AiProviderService.DefaultWithoutDependencies.pipe(
						Layer.provideMerge(AiRepository.Default),
						Layer.provide(
							Layer.succeed(AiCompatibleAdapter, {
								open: () => Effect.die("unauthenticated adapter must not run"),
							}),
						),
					);
					yield* Effect.gen(function* () {
						yield* (yield* AiRepository).put({ ...profile, credentialRef });
						const result = yield* Effect.either(
							(yield* AiProviderService).generate(request),
						);
						expect(Either.isLeft(result) && result.left.code).toBe(
							"AI.PROVIDER.AUTH_REQUIRED",
						);
					}).pipe(Effect.provide(layer));
				}
			}),
	);
});
