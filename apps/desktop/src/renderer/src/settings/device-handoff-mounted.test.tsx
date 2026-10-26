// @vitest-environment happy-dom
import { act, createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type {
	HardwareBridge,
	HardwareResponse,
} from "../../../shared/hardware-contracts";
import type { DeviceChoiceRequest } from "../../../shared/management";
import { App } from "../App";
import { button, click, element, input, mount } from "../management/dom-test";

vi.mock("../keys/KeyEditor", () => ({ KeyEditor: () => null }));
vi.mock("../keys/IconPicker", () => ({ IconPickerSurface: () => null }));
afterEach(() => {
	Reflect.deleteProperty(window, "quakeHardware");
	Reflect.deleteProperty(window, "quakeManagement");
	localStorage.clear();
});
it("MGMT-044 leaves device controls during a pending save and drops its old-session completion after returning for another device", async () => {
	window.history.replaceState(null, "", "/?page=controls");
	const reply = (serial: string): HardwareResponse => ({
		_tag: "ready",
		mock: true,
		snapshot: {
			serial,
			session: `session-${serial}`,
			available: true,
			preferenceStatus: "saved",
			inputMode: "device",
			preferences: {
				knobLedAlwaysOn: true,
				buzzerEnabled: true,
				alertVolume: 84,
			},
		},
	});
	let selected = "A";
	const devices = vi.fn(async (command: typeof DeviceChoiceRequest.Type) => {
		if (command.action === "select") selected = command.device.serial;
		return {
			selected,
			devices: ["A", "B"].map((serial) => ({
				serial,
				session: `session-${serial}`,
			})),
		};
	});
	Object.defineProperty(window, "quakeManagement", {
		configurable: true,
		value: {
			devices,
			platform: "darwin",
			onActivate: () => () => {},
			setTheme: async () => true,
		},
	});
	let finish: (value: HardwareResponse) => void = () => {};
	const request = vi.fn<HardwareBridge["request"]>(async (command) => {
		if (command._tag === "configure")
			return new Promise<HardwareResponse>((resolve) => {
				finish = resolve;
			});
		return reply(selected);
	});
	Object.defineProperty(window, "quakeHardware", {
		configurable: true,
		value: { request },
	});
	await mount(createElement(App));
	expect(document.body.textContent).toContain("A · Mock device");
	await click(element("#knob-led"));
	expect(request).toHaveBeenCalledWith(
		expect.objectContaining({ _tag: "configure", session: "session-A" }),
	);
	await click(element("[data-nav-page=overview]"));
	expect(element(".content-inner").getAttribute("data-page")).toBe("overview");
	await click(element("[data-nav-page=controls]"));
	await input(element<HTMLSelectElement>(".shell-device-picker select"), "B");
	expect(devices).toHaveBeenCalledWith({
		action: "select",
		device: { serial: "B", session: "session-B" },
	});
	expect(document.body.textContent).toContain("B · Mock device");
	await act(async () => finish(reply("A")));
	expect(document.body.textContent).toContain("B · Mock device");
	expect(document.body.textContent).not.toContain("A · Mock device");
	expect(button("Refresh").disabled).toBe(false);
	expect(
		request.mock.calls.filter(([command]) => command._tag === "configure"),
	).toHaveLength(1);
});
