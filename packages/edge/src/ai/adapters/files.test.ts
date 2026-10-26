import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Redacted, TestClock } from "effect";
import { AiAuthRevoked } from "../ai-errors.js";
import type { FileRequest } from "../ai-file-contracts.js";
import { AiRepository } from "../ai-repository.js";
import { AiProviderService } from "../ai-service.js";
import { workflowLayer, workflowProfile } from "../ai-test-fixtures.js";
import { AiFileAdapter, makeFileAdapter } from "./files.js";

const file = {
	id: "file-fixture",
	filename: "fixture.txt",
	bytes: 7,
	purpose: "assistants",
};
const requestId = "00112233-4455-4677-8899-aabbccddeeff";
const profile = { ...workflowProfile, settings: { filesEnabled: true } };
const layer = (fetcher: typeof fetch) =>
	workflowLayer({ open: () => Effect.die("chat must not run") }).pipe(
		Layer.provide(Layer.succeed(AiFileAdapter, makeFileAdapter(fetcher))),
	);
const request = (operation: FileRequest["operation"]): FileRequest => ({
	requestId,
	profileId: profile.id,
	operation,
});

describe("explicit provider files", () => {
	for (const operation of [
		{ _tag: "upload", name: "fixture.txt", content: "fixture" },
		{ _tag: "list" },
		{ _tag: "retrieve", fileId: file.id },
		{ _tag: "content", fileId: file.id },
		{ _tag: "delete", fileId: file.id },
	] as const)
		it.effect(
			`AI-038/244 ${operation._tag} uses selected profile with correlation`,
			() => {
				const calls: { url: string; init?: RequestInit }[] = [];
				return Effect.gen(function* () {
					yield* AiRepository.put(profile);
					const result = yield* AiProviderService.file(request(operation));
					expect(result.requestId).toBe(requestId);
					expect(calls).toHaveLength(1);
					expect(calls[0]?.url).toBe(
						`https://mock.invalid/v1/files${"fileId" in operation ? `/${file.id}${operation._tag === "content" ? "/content" : ""}` : ""}`,
					);
					expect(
						new Headers(calls[0]?.init?.headers).get("authorization"),
					).toBe("Bearer fixture-key");
					expect(calls[0]?.init?.redirect).toBe("error");
					if (operation._tag === "upload") {
						const form = calls[0]?.init?.body;
						expect(form).toBeInstanceOf(FormData);
						if (form instanceof FormData) {
							expect(form.get("purpose")).toBe("assistants");
							const upload = form.get("file");
							expect(upload).toBeInstanceOf(File);
							if (upload instanceof File)
								expect(yield* Effect.promise(() => upload.text())).toBe(
									"fixture",
								);
						}
					}
				}).pipe(
					Effect.provide(
						layer(async (url, init) => {
							calls.push({ url: String(url), ...(init ? { init } : {}) });
							return new Response(
								operation._tag === "content"
									? "fixture"
									: JSON.stringify(
											operation._tag === "list"
												? { data: [file] }
												: operation._tag === "delete"
													? { id: file.id, deleted: true }
													: file,
										),
							);
						}),
					),
				);
			},
		);
	it.effect("no opt-in and unsafe IDs fail before credentials/network", () => {
		let calls = 0;
		let credentials = 0;
		return Effect.gen(function* () {
			yield* AiRepository.put(workflowProfile);
			expect(
				yield* Effect.either(AiProviderService.file(request({ _tag: "list" }))),
			).toMatchObject({
				_tag: "Left",
				left: { code: "AI.PROVIDER.CONFIG_INVALID" },
			});
			yield* AiRepository.put(profile);
			expect(
				yield* Effect.either(
					AiProviderService.file(
						request({ _tag: "content", fileId: "../../private" }),
					),
				),
			).toMatchObject({
				_tag: "Left",
				left: { code: "AI.PROVIDER.CONFIG_INVALID" },
			});
			expect([calls, credentials]).toEqual([0, 0]);
		}).pipe(
			Effect.provide(
				workflowLayer(
					{ open: () => Effect.die("must not run") },
					{
						resolve: () => {
							credentials++;
							return Effect.succeed(Redacted.make("fixture"));
						},
						revoked: () => Effect.never,
					},
				).pipe(
					Layer.provide(
						Layer.succeed(
							AiFileAdapter,
							makeFileAdapter(async () => {
								calls++;
								return new Response();
							}),
						),
					),
				),
			),
		);
	});
	it.effect(
		"two concurrent requests finishing out of order retain their IDs",
		() =>
			Effect.gen(function* () {
				const first = yield* Deferred.make<void>();
				let calls = 0;
				const fetcher: typeof fetch = async () => {
					calls++;
					if (calls === 1) await Effect.runPromise(Deferred.await(first));
					return new Response(JSON.stringify({ data: [file] }));
				};
				yield* Effect.gen(function* () {
					yield* AiRepository.put(profile);
					const pending = yield* Effect.fork(
						AiProviderService.file(request({ _tag: "list" })),
					);
					yield* Effect.yieldNow();
					const secondId = "00112233-4455-4677-8899-aabbccddee11";
					const second = yield* AiProviderService.file({
						...request({ _tag: "list" }),
						requestId: secondId,
					});
					expect(second.requestId).toBe(secondId);
					yield* Deferred.succeed(first, undefined);
					expect((yield* Fiber.join(pending)).requestId).toBe(requestId);
				}).pipe(Effect.provide(layer(fetcher)));
			}),
	);
	for (const [status, code] of [
		[401, "AI.PROVIDER.AUTH_REQUIRED"],
		[429, "AI.PROVIDER.RATE_LIMITED"],
		[500, "AI.PROVIDER.UNAVAILABLE"],
	] as const)
		it.effect(`file HTTP ${status} remains typed and never retries`, () => {
			let calls = 0;
			return Effect.gen(function* () {
				yield* AiRepository.put(profile);
				expect(
					yield* Effect.either(
						AiProviderService.file(request({ _tag: "list" })),
					),
				).toMatchObject({ _tag: "Left", left: { code } });
				expect(calls).toBe(1);
			}).pipe(
				Effect.provide(
					layer(async () => {
						calls++;
						return new Response("secret-body", { status });
					}),
				),
			);
		});
	it.effect(
		"file cancellation aborts I/O and timeout releases a stalled request",
		() =>
			Effect.gen(function* () {
				const entered = yield* Deferred.make<void>();
				let aborted = false;
				const fetcher: typeof fetch = async (_url, init) => {
					yieldStarted();
					return new Promise((_resolve, reject) =>
						init?.signal?.addEventListener("abort", () => {
							aborted = true;
							reject(new Error("cancelled"));
						}),
					);
				};
				const yieldStarted = () =>
					Effect.runSync(Deferred.succeed(entered, undefined));
				yield* Effect.gen(function* () {
					yield* AiRepository.put(profile);
					const pending = yield* Effect.fork(
						Effect.either(AiProviderService.file(request({ _tag: "list" }))),
					);
					yield* Deferred.await(entered);
					yield* TestClock.adjust("60 seconds");
					expect(yield* Fiber.join(pending)).toMatchObject({
						_tag: "Left",
						left: { code: "AI.PROVIDER.UNAVAILABLE" },
					});
					expect(aborted).toBe(true);
				}).pipe(Effect.provide(layer(fetcher)));
			}),
	);
	it.effect(
		"malformed metadata and mismatched delete IDs fail without reflecting response text",
		() =>
			Effect.gen(function* () {
				for (const body of [
					"private-not-json",
					JSON.stringify({ id: "wrong-id", deleted: true }),
				])
					yield* Effect.gen(function* () {
						yield* AiRepository.put(profile);
						const result = yield* Effect.either(
							AiProviderService.file(
								request({ _tag: "delete", fileId: file.id }),
							),
						);
						expect(result).toMatchObject({
							_tag: "Left",
							left: { code: "AI.PROVIDER.PROTOCOL_INVALID" },
						});
						expect(JSON.stringify(result)).not.toContain("private-not-json");
					}).pipe(Effect.provide(layer(async () => new Response(body))));
			}),
	);
});

it.effect("AI-038 credential revocation aborts an in-flight upload", () =>
	Effect.gen(function* () {
		const revoked = yield* Deferred.make<never, AiAuthRevoked>();
		const entered = yield* Deferred.make<void>();
		let aborted = false;
		const fetcher: typeof fetch = (_url, init) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener(
					"abort",
					() => {
						aborted = true;
						reject(new Error("aborted"));
					},
					{ once: true },
				);
				Effect.runSync(Deferred.succeed(entered, undefined));
			});
		const testLayer = workflowLayer(
			{ open: () => Effect.die("not chat") },
			{
				resolve: () => Effect.succeed(Redacted.make("fixture-key")),
				revoked: () => Deferred.await(revoked),
			},
		).pipe(
			Layer.provide(Layer.succeed(AiFileAdapter, makeFileAdapter(fetcher))),
		);
		yield* Effect.gen(function* () {
			yield* AiRepository.put(profile);
			const pending = yield* Effect.either(
				AiProviderService.file(
					request({ _tag: "upload", name: "fixture.txt", content: "fixture" }),
				),
			).pipe(Effect.fork);
			yield* Deferred.await(entered);
			yield* Deferred.fail(revoked, new AiAuthRevoked());
			expect(yield* Fiber.join(pending)).toMatchObject({
				_tag: "Left",
				left: { code: "AI.PROVIDER.AUTH_REVOKED" },
			});
			expect(aborted).toBe(true);
		}).pipe(Effect.provide(testLayer));
	}),
);

it.effect(
	"rejects uploads exceeding the UTF-8 download byte budget before I/O",
	() => {
		let calls = 0;
		return Effect.gen(function* () {
			yield* AiRepository.put(profile);
			const result = yield* Effect.either(
				AiProviderService.file(
					request({
						_tag: "upload",
						name: "large.txt",
						content: "界".repeat(750000),
					}),
				),
			);
			expect(result).toMatchObject({
				_tag: "Left",
				left: { code: "AI.PROVIDER.CONFIG_INVALID" },
			});
			expect(calls).toBe(0);
		}).pipe(
			Effect.provide(
				layer(async () => {
					calls++;
					return Response.json(file);
				}),
			),
		);
	},
);

it.effect(
	"round trips a multibyte text upload at the UTF-8 byte boundary",
	() => {
		const content = `${"界".repeat(Math.floor(2097152 / 3))}aa`;
		let uploaded = "";
		return Effect.gen(function* () {
			yield* AiRepository.put(profile);
			yield* AiProviderService.file(
				request({ _tag: "upload", name: "boundary.txt", content }),
			);
			const result = yield* AiProviderService.file(
				request({ _tag: "content", fileId: file.id }),
			);
			expect(result).toEqual({
				requestId,
				result: { _tag: "content", content },
			});
			expect(new TextEncoder().encode(uploaded)).toHaveLength(2097152);
		}).pipe(
			Effect.provide(
				layer(async (_url, init) => {
					if (init?.body instanceof FormData) {
						const value = init.body.get("file");
						if (value instanceof File) uploaded = await value.text();
						return Response.json({
							...file,
							bytes: new TextEncoder().encode(uploaded).length,
						});
					}
					return new Response(uploaded);
				}),
			),
		);
	},
);
