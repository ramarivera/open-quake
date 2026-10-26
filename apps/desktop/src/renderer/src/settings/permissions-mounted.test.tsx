// @vitest-environment happy-dom
import { act, createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
	idleFirmware,
	type MaintenanceCommand,
	type MaintenanceView,
} from "../../../shared/maintenance-contracts";
import { useMaintenance } from "../maintenance/useMaintenance";
import { button, click, mount } from "../management/dom-test";
import { PermissionDashboard } from "./PermissionDashboard";

const view: MaintenanceView = {
	firmware: idleFirmware,
	currentVersion: "",
	serial: "",
	imageVersion: "",
	imageTrusted: false,
	permissions: [
		{ key: "accessibility", status: "denied" },
		{ key: "inputMonitoring", status: "unsupported" },
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
};
afterEach(() => {
	Reflect.deleteProperty(window, "quakeMaintenance");
	Reflect.deleteProperty(window, "quakeManagement");
	vi.useRealTimers();
});
function Dashboard() {
	return createElement(PermissionDashboard, { controller: useMaintenance() });
}
it("SETTINGS-015 polls mock status on focus/2000ms, requests only by click and offers restart now/later after a fresh grant", async () => {
	vi.useFakeTimers();
	let current = view;
	const request = vi.fn(async (command: MaintenanceCommand) => {
		if (command.action === "permission")
			current = {
				...view,
				permissions: [{ key: "accessibility", status: "granted" }],
			};
		return { ok: true, view: current, message: "" };
	});
	const restart = vi.fn(async () => true);
	Object.defineProperty(window, "quakeMaintenance", {
		configurable: true,
		value: { request },
	});
	Object.defineProperty(window, "quakeManagement", {
		configurable: true,
		value: { platform: "darwin", command: restart },
	});
	const mounted = await mount(createElement(Dashboard));
	expect(document.body.textContent).toContain("denied");
	expect(request).toHaveBeenCalledExactlyOnceWith({ action: "read" });
	await act(async () => vi.advanceTimersByTimeAsync(2000));
	expect(request).toHaveBeenCalledTimes(2);
	await act(async () => window.dispatchEvent(new Event("focus")));
	expect(request).toHaveBeenCalledTimes(3);
	expect(document.querySelectorAll("button[disabled]")).toHaveLength(1);
	await click(button("Allow access…"));
	expect(request).toHaveBeenCalledWith({
		action: "permission",
		key: "accessibility",
	});
	expect(document.body.textContent).toContain("Restart required");
	await click(button("Restart Now"));
	expect(restart).toHaveBeenCalledExactlyOnceWith({ action: "restart" });
	await click(button("Later"));
	expect(document.body.textContent).not.toContain("Restart required");
	await mounted.unmount();
	const calls = request.mock.calls.length;
	await act(async () => {
		await vi.advanceTimersByTimeAsync(4000);
		window.dispatchEvent(new Event("focus"));
	});
	expect(request).toHaveBeenCalledTimes(calls);
	expect(document.querySelector("section")).toBeNull();
});

it("SETTINGS-015 ignores an old status poll that finishes after the explicit permission action", async () => {
	let finish: (reply: {
		ok: true;
		view: MaintenanceView;
		message: string;
	}) => void = () => {};
	let reads = 0;
	const request = vi.fn(async (command: MaintenanceCommand) => {
		if (command.action === "read" && ++reads === 2)
			return new Promise<{ ok: true; view: MaintenanceView; message: string }>(
				(resolve) => {
					finish = resolve;
				},
			);
		return {
			ok: true,
			view:
				command.action === "permission"
					? {
							...view,
							permissions: [{ key: "accessibility", status: "granted" }],
						}
					: view,
			message: "",
		};
	});
	Object.defineProperty(window, "quakeMaintenance", {
		configurable: true,
		value: { request },
	});
	await mount(createElement(Dashboard));
	await act(async () => window.dispatchEvent(new Event("focus")));
	await click(button("Allow access…"));
	expect(document.body.textContent).toContain("granted");
	await act(async () => finish({ ok: true, view, message: "" }));
	expect(document.body.textContent).toContain("granted");
	expect(document.body.textContent).not.toContain("denied");
});
