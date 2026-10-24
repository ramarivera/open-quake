import { describe, expect, it, vi } from "vitest";
import type { ThemeId } from "../../../../../shared/clock-style";
import { type ClockThemeResult, ThemePreviewController } from "./themePreview";

function deferred(): {
	promise: Promise<ClockThemeResult>;
	resolve: (value: ClockThemeResult) => void;
	reject: (cause: unknown) => void;
} {
	let resolve: (value: ClockThemeResult) => void = () => {};
	let reject: (cause: unknown) => void = () => {};
	const promise = new Promise<ClockThemeResult>((ok, fail) => {
		resolve = ok;
		reject = fail;
	});
	return { promise, resolve, reject };
}

function setup() {
	const previews: (ThemeId | null)[] = [];
	const rollbacks: [ThemeId, string][] = [];
	const controller = new ThemePreviewController(
		(preview) => previews.push(preview),
		(themeId, reason) => rollbacks.push([themeId, reason]),
	);
	return { controller, previews, rollbacks };
}

describe("on-device theme switch with rollback (WIDGETS-038)", () => {
	it("shows the selection at once and keeps it when the save succeeds", async () => {
		const { controller, previews, rollbacks } = setup();
		const save = vi.fn(async (): Promise<ClockThemeResult> => ({ ok: true }));
		controller.select("cyber", save);
		expect(controller.current).toBe("cyber");
		expect(save).toHaveBeenCalledExactlyOnceWith("cyber");
		await Promise.resolve();
		await Promise.resolve();
		expect(controller.current).toBe("cyber");
		controller.persisted();
		expect(previews).toEqual(["cyber", null]);
		expect(rollbacks).toEqual([]);
	});

	it("rolls back when the store answers with a failure reason", async () => {
		const { controller, rollbacks } = setup();
		const pending = deferred();
		controller.select("cyber", () => pending.promise);
		pending.resolve({ ok: false, reason: "write-failed" });
		await pending.promise;
		await Promise.resolve();
		expect(controller.current).toBeNull();
		expect(rollbacks).toEqual([["cyber", "write-failed"]]);
	});

	it("rolls back when the save throws or rejects", async () => {
		const { controller, rollbacks } = setup();
		controller.select("anime", () => {
			throw new Error("bridge gone");
		});
		expect(controller.current).toBeNull();
		const pending = deferred();
		controller.select("tactical", () => pending.promise);
		pending.reject(new Error("ipc closed"));
		await pending.promise.catch(() => {});
		await Promise.resolve();
		expect(controller.current).toBeNull();
		expect(rollbacks).toEqual([
			["anime", "Error: bridge gone"],
			["tactical", "ipc closed"],
		]);
	});

	it("never lets an older failure undo a newer choice", async () => {
		const { controller, rollbacks } = setup();
		const first = deferred();
		const second = deferred();
		controller.select("cyber", () => first.promise);
		controller.select("anime", () => second.promise);
		first.resolve({ ok: false, reason: "write-failed" });
		await first.promise;
		await Promise.resolve();
		expect(controller.current).toBe("anime");
		expect(rollbacks).toEqual([]);
		second.resolve({ ok: true });
	});

	it("ends the preview when the persisted theme changes, ignoring late failures", async () => {
		const { controller, rollbacks } = setup();
		const pending = deferred();
		controller.select("aurora", () => pending.promise);
		controller.persisted();
		expect(controller.current).toBeNull();
		pending.resolve({ ok: false, reason: "write-failed" });
		await pending.promise;
		await Promise.resolve();
		expect(rollbacks).toEqual([]);
	});

	it("previews without a save handler (no host)", () => {
		const { controller } = setup();
		controller.select("season", undefined);
		expect(controller.current).toBe("season");
	});
});
