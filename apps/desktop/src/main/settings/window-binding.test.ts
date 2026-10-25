import { afterEach, describe, expect, it, vi } from "vitest";
import { bindSettingsWindow } from "./window-binding";

afterEach(() => vi.useRealTimers());
function windowFixture() {
	const callbacks = new Map<string, () => void>();
	const bounds = { x: 25, y: 40, width: 800, height: 600 };
	return {
		bounds,
		callbacks,
		isDestroyed: () => false,
		isMaximized: () => false,
		isFullScreen: () => false,
		getBounds: () => ({ ...bounds }),
		setBounds: vi.fn(),
		show: vi.fn(),
		on: (event: string, callback: () => void) => {
			callbacks.set(event, callback);
		},
		removeListener: (event: string) => {
			callbacks.delete(event);
		},
	};
}
describe("canonical settings window lifecycle", () => {
	it("applies restored bounds before showing, coalesces geometry, and flushes the latest change on disposal", async () => {
		vi.useFakeTimers();
		const win = windowFixture(),
			save = vi.fn(async () => {});
		const binding = bindSettingsWindow({
			startup: async () => ({ hidden: false, window: win.bounds }),
			save,
			failure: vi.fn(),
		});
		await binding.initialize(win);
		expect(win.setBounds).toHaveBeenCalledWith(win.bounds);
		expect(win.setBounds.mock.invocationCallOrder[0]).toBeLessThan(
			win.show.mock.invocationCallOrder[0] ?? 0,
		);
		win.callbacks.get("move")?.();
		win.bounds.x = 60;
		win.callbacks.get("resize")?.();
		await vi.advanceTimersByTimeAsync(250);
		expect(save).toHaveBeenCalledTimes(1);
		expect(save).toHaveBeenLastCalledWith({ ...win.bounds });
		win.bounds.y = 100;
		win.callbacks.get("move")?.();
		await binding.dispose();
		expect(save).toHaveBeenCalledTimes(2);
		expect(save).toHaveBeenLastCalledWith({ ...win.bounds });
		expect(win.callbacks.size).toBe(0);
		await vi.advanceTimersByTimeAsync(1000);
		expect(save).toHaveBeenCalledTimes(2);
	});
	it("restores a replacement after draining the previous window's geometry without presenting it before explicit activation", async () => {
		vi.useFakeTimers();
		const old = windowFixture(),
			replacement = windowFixture();
		let saved = { ...old.bounds };
		const binding = bindSettingsWindow({
			startup: async () => ({ hidden: true, window: saved }),
			save: async (bounds) => {
				saved = bounds;
			},
			failure: vi.fn(),
		});
		await binding.initialize(old);
		old.bounds.x = 350;
		old.callbacks.get("move")?.();
		old.callbacks.get("closed")?.();
		await binding.initialize(replacement, false);
		expect(replacement.setBounds).toHaveBeenCalledWith({ ...old.bounds });
		expect(replacement.show).not.toHaveBeenCalled();
		expect(old.callbacks.size).toBe(0);
		await binding.dispose();
	});
	it("honors a reachable hidden plan and starts visibly after a failed settings read", async () => {
		const hidden = windowFixture();
		const binding = bindSettingsWindow({
			startup: async () => ({ hidden: true }),
			save: async () => {},
			failure: vi.fn(),
		});
		await binding.initialize(hidden);
		expect(hidden.show).not.toHaveBeenCalled();
		await binding.dispose();
		const failure = new Error("unreadable"),
			report = vi.fn(),
			win = windowFixture();
		const failed = bindSettingsWindow({
			startup: async () => {
				throw failure;
			},
			save: async () => {},
			failure: report,
		});
		await failed.initialize(win);
		expect(report).toHaveBeenCalledWith(failure);
		expect(win.show).toHaveBeenCalledOnce();
		await failed.dispose();
	});
	it("doesn't persist maximized geometry and keeps later saves usable after a failed write", async () => {
		vi.useFakeTimers();
		const win = windowFixture(),
			failure = new Error("disk"),
			report = vi.fn();
		const save = vi
			.fn<() => Promise<void>>()
			.mockRejectedValueOnce(failure)
			.mockResolvedValue(undefined);
		const binding = bindSettingsWindow({
			startup: async () => ({ hidden: false }),
			save,
			failure: report,
		});
		await binding.initialize(win);
		win.isMaximized = () => true;
		win.callbacks.get("resize")?.();
		await vi.advanceTimersByTimeAsync(300);
		expect(save).not.toHaveBeenCalled();
		win.isMaximized = () => false;
		win.callbacks.get("move")?.();
		await vi.advanceTimersByTimeAsync(300);
		expect(report).toHaveBeenCalledWith(failure);
		win.callbacks.get("move")?.();
		await binding.dispose();
		expect(save).toHaveBeenCalledTimes(2);
	});
});
