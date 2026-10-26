import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, TestClock } from "effect";
import { vi } from "vitest";
import { resolveAppLocale } from "../../../../../packages/edge/src/settings/settings-invariants";
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
						expect(request.detail).toContain("far right of your other screens");
						expect(request.detail).toContain("System Settings > Displays");
						expect(request.detail).not.toContain("CoreGraphics");
						expect(request.detail).not.toContain("osascript");
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

it.scoped(
	"SETTINGS-064: a saved live locale change localizes the next native prompt without rebuilding the service",
	() =>
		Effect.gen(function* () {
			let locale = "en";
			const prompt = vi.fn<PromptEdges["prompt"]>(() => Effect.succeed(1));
			const service = yield* makeDisplayPrompts(
				edges({ platform: "darwin", locale: () => locale, prompt }),
			);
			for (const next of [
				"zh",
				"en",
				"es",
				"fr",
				"ko",
				"de",
				"it",
				"ja",
				"unsupported",
			]) {
				locale = next;
				yield* service.repair(portrait);
				const expected = strings.locales[resolveAppLocale(next)].displayMode;
				expect(prompt).toHaveBeenLastCalledWith(
					expect.objectContaining({
						title: expected.title,
						message: expected.farRight,
						detail: `\n\n${expected.placementDetail}`,
						buttons: [expected.switch, expected.orientationLater],
					}),
				);
			}
		}),
);

it.scoped(
	"MAIN-044 Windows extend obeys accepted, declined, failed and mock consent",
	() =>
		Effect.gen(function* () {
			const native = vi.fn<NonNullable<PromptEdges["windowsExtend"]>>(
				() => Effect.void,
			);
			let response = 1;
			const service = yield* makeDisplayPrompts(
				edges({
					platform: "win32",
					windowsExtend: native,
					prompt: () => Effect.succeed(response),
				}),
			);
			expect(yield* service.prepareWindows()).toBe(false);
			expect(native).not.toHaveBeenCalled();
			response = 0;
			expect(yield* service.prepareWindows()).toBe(true);
			expect(native).toHaveBeenCalledOnce();
			const error = new DisplayOperationFailed(new Error("token=private"));
			native.mockImplementation(() => Effect.fail(error));
			const failure = yield* Effect.flip(service.prepareWindows());
			expect(failure.code).toBe(error.code);
			expect(failure.originalCause).toBe(error.originalCause);
			expect(JSON.stringify(failure)).not.toContain("private");
			const mock = yield* makeDisplayPrompts(
				edges({ platform: "win32", mock: true, windowsExtend: native }),
			);
			yield* mock.prepareWindows();
			expect(native).toHaveBeenCalledTimes(2);
		}),
);
it.scoped(
	"MAIN-058 keeps Later connected and quits only for an explicit Disconnect choice",
	() =>
		Effect.gen(function* () {
			const disconnect = vi.fn(() => Effect.void);
			const native = vi.fn<PromptEdges["native"]>((action) =>
				Effect.succeed(action === "probe" ? "mirrored" : "applied"),
			);
			let response = 1;
			const prompt = vi.fn<PromptEdges["prompt"]>(() =>
				Effect.succeed(response),
			);
			const service = yield* makeDisplayPrompts(
				edges({ platform: "darwin", native, prompt, disconnect }),
			);
			yield* service.check(portrait, false);
			expect(prompt.mock.calls[0]?.[0].buttons).toEqual([
				strings.displayMode.switch,
				strings.displayMode.orientationLater,
				strings.displayMode.disconnect,
			]);
			expect(disconnect).not.toHaveBeenCalled();
			yield* TestClock.adjust(600000);
			response = 2;
			yield* service.check(portrait, false);
			expect(disconnect).toHaveBeenCalledOnce();
			expect(native.mock.calls.map(([action]) => action)).toEqual([
				"probe",
				"probe",
			]);
		}),
);
it.scoped(
	"SETTINGS-087 wizard suppresses portrait prompts until it closes",
	() =>
		Effect.gen(function* () {
			const prompt = vi.fn(() => Effect.succeed(1));
			const service = yield* makeDisplayPrompts(edges({ prompt }));
			yield* service.check(portrait, false, true);
			yield* TestClock.adjust(20000);
			yield* service.check(portrait, false, true);
			expect(prompt).not.toHaveBeenCalled();
			yield* service.check(portrait, false, false);
			yield* TestClock.adjust(2499);
			yield* service.check(portrait, false, false);
			expect(prompt).not.toHaveBeenCalled();
			yield* TestClock.adjust(1);
			yield* service.check(portrait, false, false);
			expect(prompt).toHaveBeenCalledOnce();
		}),
);
it.scoped(
	"MAIN-057 persists first-run success only after consent and native success, and reads it on restart",
	() =>
		Effect.gen(function* () {
			let saved = false;
			let response = 1;
			let broken = false;
			const save = vi.fn(() =>
				Effect.sync(() => {
					saved = true;
				}),
			);
			const read = vi.fn(() => Effect.sync(() => saved));
			const native: PromptEdges["native"] = (action) =>
				action === "probe"
					? Effect.succeed("mirrored")
					: broken
						? Effect.fail(new DisplayOperationFailed(new Error("failure")))
						: Effect.succeed("applied");
			const config = edges({
				platform: "darwin",
				arrangement: { read, save },
				prompt: () => Effect.succeed(response),
				native,
			});
			const service = yield* makeDisplayPrompts(config);
			yield* service.repair(portrait);
			expect(save).not.toHaveBeenCalled();
			response = 0;
			broken = true;
			yield* Effect.flip(service.repair(portrait));
			expect(save).not.toHaveBeenCalled();
			broken = false;
			yield* service.repair(portrait);
			expect(save).toHaveBeenCalledOnce();
			const restarted = yield* makeDisplayPrompts(config);
			yield* restarted.repair(portrait);
			expect(read).toHaveBeenCalledTimes(2);
			expect(save).toHaveBeenCalledOnce();
		}),
);
it.scoped(
	"MAIN-057 retains a failed native probe on decline and uses consented geometry fallback",
	() =>
		Effect.gen(function* () {
			let accept = false;
			const error = new DisplayOperationFailed(new Error("probe exit"));
			const native = vi.fn<PromptEdges["native"]>((action) =>
				action === "probe" ? Effect.fail(error) : Effect.succeed("applied"),
			);
			const service = yield* makeDisplayPrompts(
				edges({
					platform: "darwin",
					native,
					prompt: () => Effect.succeed(accept ? 0 : 1),
				}),
			);
			const failed = yield* Effect.flip(service.check(portrait, false));
			expect(failed.code).toBe(error.code);
			expect(failed.originalCause).toBe(error.originalCause);
			expect(native.mock.calls.map(([action]) => action)).toEqual(["probe"]);
			accept = true;
			yield* TestClock.adjust(600000);
			expect(yield* service.check(portrait, false)).toBe(true);
			expect(native.mock.calls.map(([action]) => action)).toEqual([
				"probe",
				"probe",
				"fix",
			]);
		}),
);

it.scoped(
	"SETTINGS-064: Windows consent uses the saved live locale on every action",
	() =>
		Effect.gen(function* () {
			let locale = "en";
			const prompt = vi.fn<PromptEdges["prompt"]>(() => Effect.succeed(1));
			const extend = vi.fn(() => Effect.void);
			const service = yield* makeDisplayPrompts(
				edges({
					platform: "win32",
					locale: () => locale,
					prompt,
					windowsExtend: extend,
				}),
			);
			for (const next of [...Object.keys(strings.locales), "unsupported"]) {
				locale = next;
				expect(yield* service.prepareWindows()).toBe(false);
				const text = strings.locales[resolveAppLocale(next)].displayMode;
				expect(prompt).toHaveBeenLastCalledWith(
					expect.objectContaining({
						title: text.title,
						message: text.message,
						detail: text.windowsExtendDetail,
						buttons: [text.switch, text.orientationLater],
					}),
				);
			}
			expect(extend).not.toHaveBeenCalled();
		}),
);

it.scoped(
	"SETTINGS-064: hidden mirror reminders retain localized Disconnect after a live switch",
	() =>
		Effect.gen(function* () {
			let locale = "en";
			const prompt = vi.fn<PromptEdges["prompt"]>(() => Effect.succeed(2));
			const disconnect = vi.fn(() => Effect.void);
			const service = yield* makeDisplayPrompts(
				edges({
					platform: "darwin",
					locale: () => locale,
					prompt,
					disconnect,
					hiddenMirroring: () => Effect.succeed(true),
				}),
			);
			for (const next of [...Object.keys(strings.locales), "unsupported"]) {
				locale = next;
				yield* service.check(undefined, false);
				const text = strings.locales[resolveAppLocale(next)].displayMode;
				expect(prompt).toHaveBeenLastCalledWith(
					expect.objectContaining({
						title: text.title,
						message: text.message,
						detail: `${text.message}. ${text.laterDetail}`,
						buttons: [
							text.openDisplaySettings,
							text.orientationLater,
							text.disconnect,
						],
					}),
				);
				yield* TestClock.adjust(600000);
			}
			expect(disconnect).toHaveBeenCalledTimes(9);
		}),
);

it.scoped(
	"MAIN-056 wizard suppresses repeated orientation warnings and preserves Later after closing",
	() =>
		Effect.gen(function* () {
			const prompt = vi.fn<PromptEdges["prompt"]>(() => Effect.succeed(1));
			const service = yield* makeDisplayPrompts(edges({ prompt }));
			yield* service.check(portrait, false, true);
			yield* TestClock.adjust(3000);
			yield* service.check(portrait, false, true);
			expect(prompt).not.toHaveBeenCalled();
			yield* service.check(portrait, false, false);
			yield* TestClock.adjust(2500);
			yield* service.check(portrait, false, false);
			expect(prompt).toHaveBeenCalledOnce();
			yield* service.check(portrait, false, true);
			yield* TestClock.adjust(1000);
			yield* service.check(portrait, false, false);
			expect(prompt).toHaveBeenCalledOnce();
		}),
);
