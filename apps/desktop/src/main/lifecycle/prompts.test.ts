import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, TestClock } from "effect";
import { vi } from "vitest";
import strings from "../../shared/lifecycle-strings.json";
import { makeDisplay } from "../test/display";
import {
	DisplayOperationFailed,
	farRightOrigins,
	hasHiddenQuakeMirror,
} from "./native-display";
import { makeDisplayPrompts, type PromptEdges } from "./prompts";

const primary = makeDisplay();
const portrait = makeDisplay({ id: 2, size: { width: 480, height: 1920 } });
function edges(overrides: Partial<PromptEdges> = {}): PromptEdges {
	return {
		platform: "linux",
		mock: false,
		displays: () => [primary, portrait],
		primaryId: () => 1,
		prompt: () => Effect.succeed(1),
		openSettings: () => Effect.void,
		native: () => Effect.succeed("extended"),
		...overrides,
	};
}
describe("display prompts", () => {
	it.scoped(
		"confirms portrait for 2.5 seconds and Later suppresses it for ten minutes",
		() =>
			Effect.gen(function* () {
				const prompt = vi.fn<PromptEdges["prompt"]>(() => Effect.succeed(1));
				const service = yield* makeDisplayPrompts(edges({ prompt }));
				yield* service.check(portrait, false);
				yield* TestClock.adjust(2499);
				yield* service.check(portrait, false);
				expect(prompt).not.toHaveBeenCalled();
				yield* TestClock.adjust(1);
				yield* service.check(portrait, false);
				expect(prompt).toHaveBeenCalledOnce();
				expect(prompt.mock.calls[0]?.[0]).toMatchObject({
					buttons: [strings.displayMode.orientationLater],
				});
				yield* TestClock.adjust(599_999);
				yield* service.check(portrait, false);
				expect(prompt).toHaveBeenCalledOnce();
				yield* TestClock.adjust(1);
				yield* service.check(portrait, false);
				expect(prompt).toHaveBeenCalledTimes(2);
			}),
	);
	it.scoped(
		"ignores portrait for six seconds after landscape and opens the OS settings on consent",
		() =>
			Effect.gen(function* () {
				const open = vi.fn(() => Effect.void);
				const prompt = vi.fn<PromptEdges["prompt"]>(() => Effect.succeed(0));
				const service = yield* makeDisplayPrompts(
					edges({ prompt, openSettings: open, platform: "win32" }),
				);
				yield* service.check(primary, false);
				yield* TestClock.adjust(5999);
				yield* service.check(portrait, false);
				yield* TestClock.adjust(1);
				yield* service.check(portrait, false);
				expect(prompt).not.toHaveBeenCalled();
				yield* TestClock.adjust(2500);
				yield* service.check(portrait, false);
				expect(open).toHaveBeenCalledOnce();
				expect(prompt.mock.calls[0]?.[0]).toMatchObject({
					detail: strings.displayMode.orientationDetailWin32,
				});
			}),
	);
	it.scoped(
		"never mutates macOS layout before explicit consent, and snoozes Later",
		() =>
			Effect.gen(function* () {
				const calls: string[] = [];
				let accept = false;
				const native: PromptEdges["native"] = (action) =>
					Effect.sync(() => {
						calls.push(action);
						return action === "probe" ? "mirrored" : "applied";
					});
				const prompt: PromptEdges["prompt"] = (request) =>
					Effect.sync(() => {
						expect(request.detail).toContain("CGConfigureDisplayOrigin");
						expect(request.defaultId).toBe(1);
						return accept ? 0 : 1;
					});
				const service = yield* makeDisplayPrompts(
					edges({ platform: "darwin", native, prompt }),
				);
				yield* service.check(portrait, false);
				expect(calls).toEqual(["probe"]);
				yield* TestClock.adjust(599_999);
				yield* service.check(portrait, false);
				expect(calls).toEqual(["probe"]);
				accept = true;
				yield* TestClock.adjust(1);
				yield* service.check(portrait, false);
				expect(calls).toEqual(["probe", "probe", "fix"]);
			}),
	);
	it.scoped(
		"skips all native operations and prompts in mock mode and while locked",
		() =>
			Effect.gen(function* () {
				const native = vi.fn(() => Effect.succeed("mirrored"));
				const prompt = vi.fn<PromptEdges["prompt"]>(() => Effect.succeed(0));
				const mock = yield* makeDisplayPrompts(
					edges({ platform: "darwin", mock: true, native, prompt }),
				);
				yield* mock.check(portrait, false);
				yield* mock.repair(portrait);
				const real = yield* makeDisplayPrompts(
					edges({ platform: "darwin", native, prompt }),
				);
				yield* real.check(portrait, true);
				expect(native).not.toHaveBeenCalled();
				expect(prompt).not.toHaveBeenCalled();
			}),
	);
	it.scoped(
		"detects a strip hidden by mirroring on first launch and opens settings only after consent",
		() =>
			Effect.gen(function* () {
				const open = vi.fn(() => Effect.void);
				const native = vi.fn(() => Effect.succeed("applied"));
				const probe = vi.fn(() => Effect.succeed(true));
				const prompt = vi.fn<PromptEdges["prompt"]>(() => Effect.succeed(1));
				const service = yield* makeDisplayPrompts(
					edges({
						platform: "darwin",
						hiddenMirroring: probe,
						prompt,
						native,
						openSettings: open,
					}),
				);
				yield* service.check(undefined, false);
				expect(prompt).toHaveBeenCalledOnce();
				expect(open).not.toHaveBeenCalled();
				expect(native).not.toHaveBeenCalled();
				yield* TestClock.adjust(600_000);
				prompt.mockImplementation(() => Effect.succeed(0));
				yield* service.check(undefined, false);
				expect(open).toHaveBeenCalledOnce();
				expect(native).not.toHaveBeenCalled();
			}),
	);
	it("reads only a named Quake mirror from profiler data", () => {
		expect(
			hasHiddenQuakeMirror({
				SPDisplaysDataType: [
					{
						spdisplays_ndrvs: [
							{ _name: "DK-QUAKE", spdisplays_mirror: "spdisplays_on" },
						],
					},
				],
			}),
		).toBe(true);
		expect(
			hasHiddenQuakeMirror({
				_name: "Desktop",
				spdisplays_mirror: "spdisplays_on",
			}),
		).toBe(false);
		expect(
			hasHiddenQuakeMirror({
				_name: "DK-QUAKE",
				spdisplays_mirror: "spdisplays_off",
			}),
		).toBe(false);
	});
	it.scoped("keeps the native failure identity for a consented repair", () =>
		Effect.gen(function* () {
			const cause = new Error("private native path");
			const error = new DisplayOperationFailed(cause);
			const service = yield* makeDisplayPrompts(
				edges({
					platform: "darwin",
					prompt: () => Effect.succeed(0),
					native: () => Effect.fail(error),
				}),
			);
			const failed = yield* Effect.flip(service.repair(portrait));
			expect(failed.code).toBe(error.code);
			expect(failed.originalCause).toBe(cause);
		}),
	);

	it.scoped(
		"snoozes automatic layout prompts for ten minutes from a failed repair while allowing explicit retry",
		() =>
			Effect.gen(function* () {
				const error = new DisplayOperationFailed(
					new Error("private native failure"),
				);
				const landscape = makeDisplay({
					id: 2,
					size: { width: 1920, height: 480 },
				});
				const prompt = vi.fn<PromptEdges["prompt"]>(() => Effect.succeed(0));
				const native = vi.fn<PromptEdges["native"]>((action) =>
					action === "probe"
						? Effect.succeed("mirrored")
						: Effect.sleep(2000).pipe(Effect.zipRight(Effect.fail(error))),
				);
				const service = yield* makeDisplayPrompts(
					edges({ platform: "darwin", prompt, native }),
				);
				const failed = yield* service
					.check(landscape, false)
					.pipe(Effect.flip, Effect.forkScoped);
				yield* TestClock.adjust(2000);
				const failure = yield* Fiber.join(failed);
				expect(failure._tag).toBe("DisplayOperationFailed");
				expect(failure.code).toBe(error.code);
				expect(failure.originalCause).toBe(error.originalCause);
				yield* TestClock.adjust(1000);
				yield* service.check(landscape, false);
				yield* TestClock.adjust(598_999);
				yield* service.check(landscape, false);
				expect(prompt).toHaveBeenCalledOnce();
				expect(native.mock.calls.map(([action]) => action)).toEqual([
					"probe",
					"fix",
				]);
				// Cooldown starts when the two-second native attempt failed.
				native.mockImplementation((action) =>
					Effect.succeed(action === "probe" ? "mirrored" : "applied"),
				);
				yield* TestClock.adjust(1);
				yield* service.check(landscape, false);
				expect(prompt).toHaveBeenCalledTimes(2);
				prompt.mockImplementation(() => Effect.succeed(1));
				yield* service.repair(landscape);
				yield* service.check(landscape, false);
				expect(prompt).toHaveBeenCalledTimes(3);
				prompt.mockImplementation(() => Effect.succeed(0));
				yield* service.repair(landscape);
				expect(prompt).toHaveBeenCalledTimes(4);
				expect(native.mock.calls.map(([action]) => action)).toEqual([
					"probe",
					"fix",
					"probe",
					"fix",
					"fix",
				]);
			}),
	);
	it("moves a primary strip to the right while preserving other relative origins", () => {
		const secondary = makeDisplay({
			id: 3,
			bounds: { x: 2000, y: 100, width: 1000, height: 600 },
		});
		expect(
			farRightOrigins([portrait, primary, secondary], portrait, 2),
		).toEqual([
			{ id: 1, x: 0, y: 0 },
			{ id: 3, x: 2000, y: 100 },
			{ id: 2, x: 3000, y: 0 },
		]);
	});
	it("retains native causes privately with scrubbed diagnostics", () => {
		const cause = new Error("token=secret /private/path");
		const error = new DisplayOperationFailed(cause);
		expect(error.code).toBe("DESKTOP.DISPLAY.OPERATION_FAILED");
		expect(error.originalCause).toBe(cause);
		expect(JSON.stringify(error)).not.toContain("secret");
		expect(JSON.stringify(error)).not.toContain("/private");
	});
});
