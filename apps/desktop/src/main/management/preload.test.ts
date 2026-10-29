// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { expect, it, vi } from "vitest";
import { ConnectionCheck } from "../../renderer/src/ConnectionDiagnostic";
import { button, click, mount } from "../../renderer/src/management/dom-test";
import { PermissionDashboard } from "../../renderer/src/settings/PermissionDashboard";
import { idleFirmware } from "../../shared/maintenance-contracts";
import type { ManagementBridge } from "../../shared/management";
import {
	MANAGEMENT_ACTIVATE,
	MANAGEMENT_COMMAND,
	MANAGEMENT_READY,
} from "../../shared/management";

const native = vi.hoisted(() => ({
	bridge: undefined as ManagementBridge | undefined,
	listener: undefined as ((event: object, value: unknown) => void) | undefined,
	invoke: vi.fn(async () => true),
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
		invoke: native.invoke,
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

it("MGMT-039 SETTINGS-015 real management preload enables support and forwards Restart now to shell IPC", async () => {
	vi.stubGlobal("process", { ...process, isMainFrame: true });
	vi.resetModules();
	await import("./preload");
	expect(native.bridge?.externalLinks).toBe(true);
	Object.defineProperty(window, "quakeManagement", {
		configurable: true,
		value: native.bridge,
	});
	let grant = () => {};
	function Dashboard() {
		const [granted, setGranted] = useState(false);
		grant = () => setGranted(true);
		return createElement(PermissionDashboard, {
			controller: {
				busy: false,
				view: {
					firmware: idleFirmware,
					currentVersion: "",
					serial: "",
					imageVersion: "",
					imageTrusted: false,
					permissions: [
						{ key: "accessibility", status: granted ? "granted" : "denied" },
					],
					macOS: true,
					appVersion: "0.0.0",
					update: {
						state: "disabled",
						version: "",
						progress: 0,
						reason: "",
						prompt: false,
					},
				},
				request: async () => {},
			},
		});
	}
	try {
		const mounted = await mount(createElement(Dashboard));
		await click(button("Allow access…"));
		await act(async () => grant());
		expect(button("Restart now").disabled).toBe(false);
		await click(button("Restart now"));
		expect(native.invoke).toHaveBeenCalledExactlyOnceWith(MANAGEMENT_COMMAND, {
			action: "restart",
		});
		await mounted.unmount();
		await mount(createElement(ConnectionCheck));
		expect(document.querySelector("a")?.getAttribute("aria-disabled")).toBe(
			"false",
		);
	} finally {
		Reflect.deleteProperty(window, "quakeManagement");
		vi.unstubAllGlobals();
	}
});
