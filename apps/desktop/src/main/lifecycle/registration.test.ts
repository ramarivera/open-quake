import { Effect, ManagedRuntime } from "effect";
import { BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { describe, expect, it, vi } from "vitest";
import { DeviceLifecycle } from "./lifecycle-service";
import { canRequestLifecycle, registerLifecycle } from "./registration";

const electron = vi.hoisted(() => ({
	BrowserWindow: class {
		webContents = {
			listeners: new Map<string, Set<() => void>>(),
			on(event: string, listener: () => void) {
				const entries = this.listeners.get(event) ?? new Set<() => void>();
				entries.add(listener);
				this.listeners.set(event, entries);
			},
			removeListener(event: string, listener: () => void) {
				this.listeners.get(event)?.delete(listener);
			},
			emit(event: string) {
				for (const listener of this.listeners.get(event) ?? []) listener();
			},
		};
	},
	ipcMain: {
		handle:
			vi.fn<
				(
					name: string,
					handler: (
						event: IpcMainInvokeEvent,
						input: unknown,
					) => Promise<unknown>,
				) => void
			>(),
		removeHandler: vi.fn(),
	},
}));
vi.mock("electron", () => electron);
// Registration's identity checks are tested independently; no native display or HID edge exists here.
describe("diagnostic authorization", () => {
	it.each([
		["file:///app/renderer/index.html?surface=management", true, true, true],
		["https://foreign.invalid/renderer/index.html", true, true, false],
		["file:///app/renderer/index.html", false, true, false],
		["file:///app/renderer/index.html?surface=management", true, false, false],
	])(
		"checks exact document, main frame and main-owned management identity for %s",
		(url, main, management, expected) => {
			expect(
				canRequestLifecycle(
					String(url),
					"file:///app/renderer/index.html",
					Boolean(main),
					Boolean(management),
					{ action: "redetect" },
				),
			).toBe(expected);
		},
	);
});

it("SETTINGS-087 clears wizard suppression on reload/destroy and transfers listeners to replacement management", async () => {
	let management = new BrowserWindow();
	const runtime = ManagedRuntime.make(
		DeviceLifecycle.Default({
			mock: true,
			development: false,
			displays: () => [],
			watch: () => () => {},
			bus: () => undefined,
			panel: () => {},
			notify: () => {},
			prompts: {
				platform: "linux",
				mock: true,
				displays: () => [],
				primaryId: () => 1,
				prompt: () => Effect.die("No native prompt in registration test"),
				native: () => Effect.die("No native operation in registration test"),
				openSettings: () => Effect.void,
			},
		}),
	);
	const service = await runtime.runPromise(DeviceLifecycle);
	const wizard = vi.spyOn(service, "wizard");
	const remove = registerLifecycle(
		runtime,
		() => management,
		"file:///app/renderer/index.html",
	);
	try {
		await vi.waitFor(() => expect(wizard).toHaveBeenCalledWith(false));
		for (const event of ["did-start-loading", "destroyed"]) {
			await runtime.runPromise(service.wizard(true));
			wizard.mockClear();
			management.webContents.emit(event);
			await vi.waitFor(() =>
				expect(wizard).toHaveBeenCalledExactlyOnceWith(false),
			);
		}
		const previous = management;
		management = new BrowserWindow();
		wizard.mockClear();
		remove.bindManagement();
		await vi.waitFor(() =>
			expect(wizard).toHaveBeenCalledExactlyOnceWith(false),
		);
		wizard.mockClear();
		previous.webContents.emit("did-start-loading");
		expect(wizard).not.toHaveBeenCalled();
		management.webContents.emit("did-start-loading");
		await vi.waitFor(() =>
			expect(wizard).toHaveBeenCalledExactlyOnceWith(false),
		);
		remove();
		wizard.mockClear();
		management.webContents.emit("destroyed");
		expect(wizard).not.toHaveBeenCalled();
	} finally {
		remove();
		await runtime.dispose();
	}
});
