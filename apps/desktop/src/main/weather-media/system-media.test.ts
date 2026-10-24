import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
	type NativeMediaAction,
	type NativeMediaState,
	SystemMediaAdapter,
	SystemMediaService,
	systemMediaStub,
} from "./system-media";
import { mediaSession } from "./test-fixtures";

describe("system media intent conductor", () => {
	for (const playing of [true, false]) {
		it(`rejects toggle when ${playing ? "pause" : "play"} capability is absent`, async () => {
			const actions: NativeMediaAction[] = [];
			const adapter = Layer.succeed(SystemMediaAdapter, {
				read: () =>
					Effect.succeed({
						session: {
							...mediaSession,
							playing,
							canPlay: false,
							canPause: false,
						},
						error: null,
					}),
				control: (action) =>
					Effect.sync(() => {
						actions.push(action);
						return true;
					}),
			});
			const result = await Effect.runPromise(
				SystemMediaService.control("toggle").pipe(
					Effect.provide(
						SystemMediaService.Default.pipe(Layer.provide(adapter)),
					),
				),
			);
			expect(result.accepted).toBe(false);
			expect(actions).toEqual([]);
		});
	}
	it("serializes fresh toggle direction, respects navigation capability and reconciles after rejection", async () => {
		let state: NativeMediaState = {
			session: { ...mediaSession, canNext: false },
			error: null,
		};
		let reads = 0;
		const actions: NativeMediaAction[] = [];
		const adapter = Layer.succeed(SystemMediaAdapter, {
			read: () =>
				Effect.sync(() => {
					reads++;
					return state;
				}),
			control: (action) =>
				Effect.sync(() => {
					actions.push(action);
					state = {
						...state,
						session: {
							...mediaSession,
							canNext: false,
							playing: action === "play",
						},
					};
					return true;
				}),
		});
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* SystemMediaService;
				const toggles = yield* Effect.all(
					[service.control("toggle"), service.control("toggle")],
					{ concurrency: "unbounded" },
				);
				const next = yield* service.control("next");
				return { toggles, next };
			}).pipe(
				Effect.provide(SystemMediaService.Default.pipe(Layer.provide(adapter))),
			),
		);
		expect(actions).toEqual(["pause", "play"]);
		expect(reads).toBe(6);
		expect(result.next.accepted).toBe(false);
		expect(result.toggles[1]?.media.session?.playing).toBe(true);
	});
	for (const [platform, error] of [
		["darwin", "MEDIAREMOTE_UNAVAILABLE"],
		["win32", "SMTC_UNAVAILABLE"],
		["linux", "UNSUPPORTED_PLATFORM"],
	]) {
		it(`reports ${platform} stub without a control side effect`, async () => {
			const reply = await Effect.runPromise(
				SystemMediaService.control("toggle").pipe(
					Effect.provide(
						SystemMediaService.Default.pipe(
							Layer.provide(systemMediaStub(platform ?? "")),
						),
					),
				),
			);
			expect(reply.accepted).toBe(false);
			expect(reply.media.error).toBe(error);
			expect(reply.media.session).toBeNull();
		});
	}
});
