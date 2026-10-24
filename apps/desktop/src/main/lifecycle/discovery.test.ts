import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Option, TestClock } from "effect";
import type { Display } from "electron";
import { makeDisplay } from "../test/display";
import { makeDiscovery } from "./discovery";

const primary = makeDisplay();
const strip = makeDisplay({
	id: 2,
	label: "DK-QUAKE",
	size: { width: 1920, height: 480 },
});
const other = makeDisplay({ id: 3, size: strip.size });
const harness = Effect.fn("Test.discovery")(function* (
	mode: "pair" | "timeout" | "ambiguous" = "pair",
) {
	let displays: readonly Display[] = [primary, strip, other];
	let changed = (): void => {};
	let watching = false;
	const power: boolean[] = [];
	const discovery = yield* makeDiscovery({
		displays: () => displays,
		watch: (listener) => {
			watching = true;
			changed = listener;
			return () => {
				watching = false;
			};
		},
		bus: () => ({
			on: () => () => {},
			currentStatus: () => undefined,
			setScreenPower: (on) =>
				Effect.sync(() => {
					expect(watching).toBe(true);
					power.push(on);
					if (mode === "pair")
						displays = on
							? [primary, { ...strip, id: 4 }, other]
							: [primary, other];
					if (mode === "ambiguous")
						displays = on ? [primary, strip, other] : [primary];
					changed();
					return true;
				}),
		}),
	});
	return { discovery, power, watching: () => watching };
});
describe("screen-off pairing", () => {
	it.scoped(
		"binds the sole exact-label, exact-size strip without EDID disappearance",
		() =>
			Effect.gen(function* () {
				let writes = 0;
				const discovery = yield* makeDiscovery({
					displays: () => [primary, strip],
					watch: () => () => {},
					bus: () => ({
						on: () => () => {},
						currentStatus: () => undefined,
						setScreenPower: () =>
							Effect.sync(() => {
								writes++;
								return true;
							}),
					}),
				});
				const result = yield* discovery.run();
				expect(result.issue).toBe("none");
				expect(Option.getOrUndefined(result.display)?.id).toBe(strip.id);
				expect(writes).toBe(0);
			}),
	);

	for (const candidate of [
		{ ...strip, label: "Other device" },
		{ ...strip, size: { width: 1600, height: 900 } },
		{ ...strip, size: { width: 1919, height: 480 } },
	])
		it.scoped(
			`requires blanking when name or physical size does not identify ${candidate.label} ${candidate.size.width}`,
			() =>
				Effect.gen(function* () {
					const power: boolean[] = [];
					const discovery = yield* makeDiscovery({
						displays: () => [primary, candidate],
						watch: () => () => {},
						bus: () => ({
							on: () => () => {},
							currentStatus: () => undefined,
							setScreenPower: (on) =>
								Effect.sync(() => {
									power.push(on);
									return true;
								}),
						}),
					});
					const fiber = yield* discovery.run().pipe(Effect.fork);
					yield* TestClock.adjust(30_000);
					const result = yield* Fiber.join(fiber);
					expect(result.issue).toBe("timeout");
					expect(Option.isNone(result.display)).toBe(true);
					expect(power).toEqual([false, true]);
				}),
		);

	it.scoped(
		"returns immediately without screen-power writes when no candidates exist",
		() =>
			Effect.gen(function* () {
				const power: boolean[] = [];
				const discovery = yield* makeDiscovery({
					displays: () => [primary],
					watch: () => () => {},
					bus: () => ({
						on: () => () => {},
						currentStatus: () => undefined,
						setScreenPower: (on) =>
							Effect.sync(() => {
								power.push(on);
								return true;
							}),
					}),
				});
				const fiber = yield* discovery.run().pipe(Effect.fork);
				yield* TestClock.adjust(30_000);
				expect((yield* Fiber.join(fiber)).issue).toBe("unavailable");
				expect(power).toEqual([]);
			}),
	);
	it.scoped(
		"observes synchronous disappearance, powers on, and binds a changed ID among candidates",
		() =>
			Effect.gen(function* () {
				const h = yield* harness();
				const result = yield* h.discovery.run();
				expect(result.issue).toBe("none");
				expect(Option.getOrUndefined(result.display)?.id).toBe(4);
				expect(h.power).toEqual([false, true]);
				expect(h.watching()).toBe(false);
			}),
	);
	for (const mode of ["timeout", "ambiguous"] as const)
		it.scoped(`restores power on ${mode} without guessing`, () =>
			Effect.gen(function* () {
				const h = yield* harness(mode);
				const fiber = yield* h.discovery.run().pipe(Effect.fork);
				yield* TestClock.adjust(30_000);
				const result = yield* Fiber.join(fiber);
				expect(result.issue).toBe("timeout");
				expect(Option.isNone(result.display)).toBe(true);
				expect(h.power).toEqual([false, true]);
				expect(h.watching()).toBe(false);
			}),
		);
	it.scoped(
		"coalesces concurrent calls and restores power before interruption completes",
		() =>
			Effect.gen(function* () {
				const h = yield* harness("timeout");
				const one = yield* h.discovery.run().pipe(Effect.fork);
				yield* Effect.yieldNow();
				const two = yield* h.discovery.run().pipe(Effect.fork);
				yield* Effect.yieldNow();
				expect(h.power).toEqual([false]);
				yield* Fiber.interrupt(one);
				yield* Fiber.await(two);
				expect(h.power).toEqual([false, true]);
				expect(h.watching()).toBe(false);
			}),
	);
});
