import type { BrowserWindow } from "electron";
import { expect, it, vi } from "vitest";
import { confirmProfileAction } from "./native-dialog";

const calls = vi.hoisted(() => ({
	showMessageBox: vi.fn(async () => ({ response: 1 })),
}));
vi.mock("electron", () => ({ dialog: calls }));
const owner = () => ({
	isDestroyed: () => false,
	isMinimized: () => true,
	isVisible: () => false,
	restore: vi.fn(),
	show: vi.fn(),
	focus: vi.fn(),
});
it("uses a visible parent and a bounded abort signal for profile approvals", async () => {
	const window = owner();
	await confirmProfileAction(
		window as unknown as BrowserWindow,
		"Run command?",
		"private command",
		10,
	);
	expect(window.restore).toHaveBeenCalledOnce();
	expect(window.show).toHaveBeenCalledOnce();
	expect(window.focus).toHaveBeenCalledOnce();
	expect(calls.showMessageBox).toHaveBeenCalledWith(
		window,
		expect.objectContaining({
			defaultId: 1,
			cancelId: 1,
			signal: expect.any(AbortSignal),
		}),
	);
});
it("never opens an unowned dialog when the management window is missing", async () => {
	calls.showMessageBox.mockClear();
	expect(await confirmProfileAction(undefined, "Run?", "command")).toBe(false);
	expect(calls.showMessageBox).not.toHaveBeenCalled();
});
