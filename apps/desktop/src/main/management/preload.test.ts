// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import type { ManagementBridge } from "../../shared/management";
import { MANAGEMENT_ACTIVATE, MANAGEMENT_READY } from "../../shared/management";

const native = vi.hoisted(() => ({
	bridge: undefined as ManagementBridge | undefined,
	listener: undefined as ((event: object, value: unknown) => void) | undefined,
	on: vi.fn(),
	off: vi.fn(),
	send: vi.fn(),
}));
vi.mock("electron", () => ({
	contextBridge: {
		exposeInMainWorld: (_name: string, bridge: ManagementBridge) => {
			native.bridge = bridge;
		},
	},
	ipcRenderer: {
		invoke: vi.fn(),
		on: (
			channel: string,
			listener: (event: object, value: unknown) => void,
		) => {
			native.on(channel);
			native.listener = listener;
		},
		off: native.off,
		send: (channel: string) => {
			native.send(channel);
			if (channel === MANAGEMENT_READY) native.listener?.({}, "settings");
		},
	},
}));

import "./preload";

it("activation subscribes before signaling ready and delivers the queued Settings route", () => {
	const receive = vi.fn();
	const remove = native.bridge?.onActivate(receive);
	expect(native.on).toHaveBeenCalledWith(MANAGEMENT_ACTIVATE);
	expect(native.send).toHaveBeenCalledWith(MANAGEMENT_READY);
	expect(native.on.mock.invocationCallOrder[0]).toBeLessThan(
		native.send.mock.invocationCallOrder[0] ?? 0,
	);
	expect(receive).toHaveBeenCalledExactlyOnceWith("settings");
	remove?.();
	expect(native.off).toHaveBeenCalledWith(MANAGEMENT_ACTIVATE, native.listener);
});
