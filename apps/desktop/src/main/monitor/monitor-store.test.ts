import { describe, expect, it } from "@effect/vitest";
import { Effect, Either } from "effect";
import { defaults } from "../../shared/monitor-contracts";
import { MonitorCollectionFailed } from "../../shared/monitor-errors";
import { type MonitorStorage, MonitorStore } from "./monitor-store";

const storage = (overrides: Partial<MonitorStorage> = {}): MonitorStorage => ({
	load: async () => undefined,
	save: async () => undefined,
	putMedia: async () => undefined,
	getMedia: async () => ({ bytes: new Uint8Array([1]), mime: "image/png" }),
	...overrides,
});
describe("monitor settings", () => {
	it.effect(
		"recovers invalid settings and clears the recovery notice after a successful save",
		() =>
			Effect.gen(function* () {
				const store = yield* MonitorStore;
				const recovered = yield* store.read();
				expect(recovered.recovered).toBe(true);
				expect(recovered.settings).toEqual(defaults());
				const saved = yield* store.save(recovered.revision, {
					...defaults(),
					styleId: "anime",
				});
				expect(saved.recovered).toBe(false);
				expect(saved.settings.styleId).toBe("anime");
			}).pipe(
				Effect.provide(
					MonitorStore.Default(
						storage({ load: async () => ({ revision: -1 }) }),
					),
				),
			),
	);
	it.effect(
		"rejects invalid rates and stale revisions without replacing saved settings",
		() =>
			Effect.gen(function* () {
				const store = yield* MonitorStore;
				expect((yield* store.read()).settings.hz).toBe(1);
				expect(
					Either.isLeft(
						yield* Effect.either(store.save(0, { ...defaults(), hz: 11 })),
					),
				).toBe(true);
				const saved = yield* store.save(0, { ...defaults(), styleId: "cyber" });
				expect(saved.revision).toBe(1);
				expect(
					Either.isLeft(yield* Effect.either(store.save(0, defaults()))),
				).toBe(true);
				expect((yield* store.read()).settings.styleId).toBe("cyber");
			}).pipe(Effect.provide(MonitorStore.Default(storage()))),
	);
	it.effect(
		"retains original cause, scrubs diagnostics and keeps last committed state on failed write",
		() => {
			const cause = new Error("secret private path", {
				cause: new Error("token=secret"),
			});
			return Effect.gen(function* () {
				const store = yield* MonitorStore;
				const result = yield* Effect.either(
					store.save(0, { ...defaults(), styleId: "anime" }),
				);
				expect(Either.isLeft(result)).toBe(true);
				if (Either.isLeft(result)) {
					expect(result.left._tag).toBe("MonitorPersistenceFailed");
					expect(result.left.code).toBe("QUAKE.MONITOR.PERSISTENCE_FAILED");
					expect(result.left.originalCause).toBe(cause);
					expect(JSON.stringify(result.left)).not.toContain("secret");
				}
				expect((yield* store.read()).revision).toBe(0);
				const error = new MonitorCollectionFailed(cause);
				expect(error.originalCause).toBe(cause);
				expect(JSON.stringify(error)).not.toContain("secret");
			}).pipe(
				Effect.provide(
					MonitorStore.Default(
						storage({
							save: async () => {
								throw cause;
							},
						}),
					),
				),
			);
		},
	);
	it.effect("stages media without saving and rejects arbitrary asset ids", () =>
		Effect.gen(function* () {
			const store = yield* MonitorStore;
			const media = yield* store.stage({
				bytes: new Uint8Array([1]),
				kind: "image",
				mime: "image/png",
				name: "picture.png",
			});
			expect((yield* store.read()).settings.media.glass).toBeUndefined();
			const result = yield* store.save(0, {
				...defaults(),
				media: { glass: media.slot },
			});
			expect(result.media.glass?.available).toBe(true);
			const invalid = yield* Effect.either(
				store.save(1, {
					...defaults(),
					media: { glass: { ...media.slot, id: "0".repeat(32) } },
				}),
			);
			expect(Either.isLeft(invalid)).toBe(true);
		}).pipe(Effect.provide(MonitorStore.Default(storage()))),
	);
	it.effect("reports missing media while retaining selected slot", () =>
		Effect.gen(function* () {
			const store = yield* MonitorStore;
			const media = yield* store.stage({
				bytes: new Uint8Array([1]),
				kind: "image",
				mime: "image/png",
				name: "missing.png",
			});
			const view = yield* store.save(0, {
				...defaults(),
				background: "custom",
				media: { glass: media.slot },
			});
			expect(view.settings.media.glass?.name).toBe("missing.png");
			expect(view.media.glass?.available).toBe(false);
		}).pipe(
			Effect.provide(
				MonitorStore.Default(
					storage({
						getMedia: async () => {
							throw new Error("missing");
						},
					}),
				),
			),
		),
	);
});
