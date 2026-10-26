import { describe, expect, it } from "@effect/vitest";
import { Effect, Either, Fiber } from "effect";
import {
	defaults,
	type MediaSlot,
	type MonitorRecord,
	STYLES,
	type StyleId,
} from "../../shared/monitor-contracts";
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
		"rejects empty normal and override selections without writing a revision",
		() =>
			Effect.gen(function* () {
				let writes = 0;
				yield* Effect.gen(function* () {
					const store = yield* MonitorStore;
					for (const settings of [
						{ ...defaults(), metrics: [] },
						{ ...defaults(), override: { active: true, hz: 1, metrics: [] } },
					]) {
						const result = yield* Effect.either(store.save(0, settings));
						expect(result).toMatchObject({
							_tag: "Left",
							left: { code: "QUAKE.MONITOR.CONFIG_INVALID" },
						});
						expect((yield* store.configuration()).revision).toBe(0);
					}
				}).pipe(
					Effect.provide(
						MonitorStore.Default(
							storage({
								save: async () => {
									writes++;
								},
							}),
						),
					),
				);
				expect(writes).toBe(0);
			}),
	);
	it.effect(
		"migrates existing saved records without losing panel preferences or enabling app tracking",
		() =>
			Effect.gen(function* () {
				const store = yield* MonitorStore;
				const view = yield* store.read();
				expect(view.recovered).toBe(false);
				expect(view.revision).toBe(9);
				expect(view.settings.styleId).toBe("cyber");
				expect(view.settings.appMonitor).toEqual({ enabled: false });
				expect(view.settings.override).toEqual({
					active: false,
					hz: 1,
					metrics: ["cpu"],
				});
				expect(view.settings.metrics).toContain("bluetooth");
			}).pipe(
				Effect.provide(
					MonitorStore.Default(
						storage({
							load: async () => ({
								revision: 9,
								settings: {
									styleId: "cyber",
									background: "none",
									media: {},
									temperatureUnit: "fahrenheit",
									enabled: true,
									hz: 2,
								},
							}),
						}),
					),
				),
			),
	);
	it.scoped(
		"settles an accepted atomic save before publishing state when its caller is interrupted",
		() =>
			Effect.gen(function* () {
				let finish: (() => void) | undefined;
				const layer = MonitorStore.Default(
					storage({
						save: async () =>
							new Promise<void>((resolve) => {
								finish = resolve;
							}),
					}),
				);
				yield* Effect.gen(function* () {
					const store = yield* MonitorStore;
					const saving = yield* store
						.save(0, { ...defaults(), hz: 2 })
						.pipe(Effect.forkScoped);
					yield* Effect.yieldNow();
					expect(finish).toBeTypeOf("function");
					const interrupt = yield* Fiber.interrupt(saving).pipe(
						Effect.forkScoped,
					);
					expect((yield* store.configuration()).revision).toBe(0);
					finish?.();
					yield* Fiber.join(interrupt);
					expect((yield* store.configuration()).settings.hz).toBe(2);
				}).pipe(Effect.provide(layer));
			}),
	);
	it.effect(
		"loads only the active or explicitly previewed style, preserving all saved slots",
		() => {
			const media: Partial<Record<StyleId, MediaSlot>> = {};
			for (const [index, style] of STYLES.entries())
				media[style] = {
					id: String(index).repeat(32),
					kind: "video",
					name: `${style}.webm`,
				};
			const record: MonitorRecord = {
				revision: 7,
				settings: { ...defaults(), background: "custom", media },
			};
			const reads: string[] = [];
			return Effect.gen(function* () {
				const store = yield* MonitorStore;
				const active = yield* store.read();
				expect(Object.keys(active.media)).toEqual(["glass"]);
				expect(reads).toEqual(["0".repeat(32)]);
				expect(active.media.glass?.url.length).toBeLessThan(45 * 1024 ** 2);
				expect(active.settings.media).toEqual(media);
				yield* store.configuration();
				expect(reads).toHaveLength(1);
				const draft = yield* store.read("cyber");
				expect(Object.keys(draft.media)).toEqual(["cyber"]);
				expect(draft.settings.styleId).toBe("glass");
				expect(reads).toEqual(["0".repeat(32), "1".repeat(32)]);
				const saved = yield* store.save(7, {
					...record.settings,
					background: "none",
				});
				expect(saved.media).toEqual({});
				expect(saved.settings.media).toEqual(media);
				expect(reads).toHaveLength(2);
			}).pipe(
				Effect.provide(
					MonitorStore.Default(
						storage({
							load: async () => record,
							getMedia: async (slot) => {
								reads.push(slot.id);
								return {
									bytes: new Uint8Array(32 * 1024 ** 2),
									mime: "video/webm",
								};
							},
						}),
					),
				),
			);
		},
	);
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
				background: "custom",
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
