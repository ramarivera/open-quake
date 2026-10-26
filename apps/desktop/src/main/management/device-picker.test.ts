import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vitest";
import { MANAGEMENT_DEVICES } from "../../shared/management";
import { registerDevicePicker } from "./device-picker";

const native = vi.hoisted(() => ({ handle: vi.fn(), removeHandler: vi.fn() }));
vi.mock("electron", () => ({ ipcMain: native }));
beforeEach(() => vi.clearAllMocks());
function fixture() {
	const win = Object.assign(new EventEmitter(), {
		webContents: Object.assign(new EventEmitter(), {
			mainFrame: { url: "https://app.test/index.html?surface=management" },
			send: vi.fn(),
			isLoadingMainFrame: () => false,
		}),
		isDestroyed: () => false,
		hide: vi.fn(),
		close: vi.fn(),
		minimize: vi.fn(),
		maximize: vi.fn(),
		unmaximize: vi.fn(),
		isMaximized: () => false,
	});
	const choices = { selected: "A", devices: [{ serial: "A", session: "s1" }] };
	const read = vi.fn(async () => choices),
		select = vi.fn(async () => true);
	const dispose = registerDevicePicker({
		management: () => win,
		renderer: "https://app.test/index.html",
		read,
		select,
	});
	const handler: unknown = native.handle.mock.calls.find(
		([name]) => name === MANAGEMENT_DEVICES,
	)?.[1];
	if (typeof handler !== "function")
		throw new Error("Missing device picker handler");
	const event = {
		sender: win.webContents,
		senderFrame: win.webContents.mainFrame,
	};
	return {
		win,
		choices,
		read,
		select,
		dispose,
		event,
		invoke: (input: unknown, from = event) => handler(from, input),
	};
}
it("SETTINGS-018 permits only the management top frame and exact live serial/session", async () => {
	const f = fixture();
	expect(await f.invoke({ action: "read" })).toEqual(f.choices);
	for (const input of [
		{ action: "read", extra: true },
		{ action: "select", device: { serial: "A", session: "old" } },
	])
		expect(await f.invoke(input)).toBeNull();
	expect(
		await f.invoke(
			{ action: "read" },
			{
				...f.event,
				senderFrame: { url: "https://app.test/index.html?surface=panel" },
			},
		),
	).toBeNull();
	expect(
		await f.invoke(
			{ action: "read" },
			{ ...f.event, sender: { ...f.win.webContents } },
		),
	).toBeNull();
	expect(f.select).not.toHaveBeenCalled();
	expect(
		await f.invoke({ action: "select", device: f.choices.devices[0] }),
	).toEqual(f.choices);
	expect(f.select).toHaveBeenCalledWith("A", "s1");
	f.dispose();
	expect(await f.invoke({ action: "read" })).toBeNull();
	expect(native.removeHandler).toHaveBeenCalledWith(MANAGEMENT_DEVICES);
});
it("MGMT-005 suppresses late selection and replies when the owner is disposed", async () => {
	const f = fixture();
	let complete = () => {};
	f.read.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				complete = () => resolve(f.choices);
			}),
	);
	const pending = f.invoke({ action: "select", device: f.choices.devices[0] });
	f.dispose();
	complete();
	expect(await pending).toBeNull();
	expect(f.select).not.toHaveBeenCalled();
});
