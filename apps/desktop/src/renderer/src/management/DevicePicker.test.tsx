// @vitest-environment happy-dom
import { act, createElement } from "react";
import { expect, it, vi } from "vitest";
import type { DeviceChoiceRequest } from "../../../shared/management";
import { DevicePicker } from "./DevicePicker";
import { element, input, mount } from "./dom-test";

it("SETTINGS-018 selects by serial, refreshes on focus and disconnect and stops callbacks after unmount", async () => {
	let selected = "A",
		devices = [
			{ serial: "A", session: "a1" },
			{ serial: "B", session: "b1" },
		];
	const request = vi.fn(async (request: typeof DeviceChoiceRequest.Type) => {
		if (request.action === "select") selected = request.device.serial;
		return { selected, devices };
	});
	Object.defineProperty(window, "quakeManagement", {
		configurable: true,
		value: { devices: request },
	});
	vi.useFakeTimers();
	try {
		const view = await mount(
			<DevicePicker>
				<span data-test="controls">Controls</span>
			</DevicePicker>,
		);
		const original = element("[data-test=controls]");
		expect(element<HTMLSelectElement>("select").value).toBe("A");
		await input(element("select"), "B");
		expect(request).toHaveBeenCalledWith({
			action: "select",
			device: { serial: "B", session: "b1" },
		});
		expect(element<HTMLSelectElement>("select").value).toBe("B");
		expect(element("[data-test=controls]")).not.toBe(original);
		devices = [{ serial: "A", session: "a1" }];
		await act(async () => window.dispatchEvent(new Event("focus")));
		expect(element<HTMLSelectElement>("select").value).toBe("B");
		expect(element("select").textContent).toContain("Disconnected");
		await view.unmount();
		const count = request.mock.calls.length;
		await act(async () => {
			await vi.advanceTimersByTimeAsync(3000);
			window.dispatchEvent(new Event("focus"));
		});
		expect(request).toHaveBeenCalledTimes(count);
	} finally {
		vi.useRealTimers();
		Object.defineProperty(window, "quakeManagement", {
			configurable: true,
			value: undefined,
		});
	}
});
