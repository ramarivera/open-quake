// @vitest-environment happy-dom
import { act, createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { MeetingSettings } from "./MeetingSettings";
import { click, element, meetingDom } from "./meeting-test-fixture";

let dom: ReturnType<typeof meetingDom>;
afterEach(async () => {
	await dom?.close();
});
it("AI-283 real settings require consent, report native cancellation/failure, and permit retry without capture", async () => {
	dom = meetingDom();
	const setup = vi.fn(
		async (_request: { action: "status" | "install" }): Promise<unknown> => ({
			platform: "darwin",
			state: "available",
		}),
	);
	Object.defineProperty(window, "quakeMeetings", {
		configurable: true,
		value: { ...window.quakeMeetings, audioSetup: setup },
	});
	vi.stubGlobal("navigator", {
		mediaDevices: {
			enumerateDevices: vi.fn(async () => []),
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		},
	});
	await dom.render(createElement(MeetingSettings, { mock: false }));
	const button = (text: string) => {
		const found = [
			...dom.host.querySelectorAll<HTMLButtonElement>("button"),
		].find((item) => item.textContent?.trim() === text);
		if (!found) throw new Error(text);
		return found;
	};
	await act(async () => button("System audio setup").click());
	expect(dom.host.textContent).toContain("administrator password");
	expect(dom.host.textContent).toContain("Multi-Output Device");
	expect(button("Install BlackHole…").disabled).toBe(true);
	expect(setup).toHaveBeenCalledTimes(1);
	setup.mockResolvedValueOnce({ platform: "darwin", state: "cancelled" });
	await click(
		'section[aria-label="System audio setup"] input[type="checkbox"]',
	);
	await act(async () => button("Install BlackHole…").click());
	expect(dom.host.textContent).toContain("Installation cancelled.");
	expect(button("Install BlackHole…").disabled).toBe(true);
	setup.mockResolvedValueOnce({ platform: "darwin", state: "failed" });
	await click(
		'section[aria-label="System audio setup"] input[type="checkbox"]',
	);
	await act(async () => button("Install BlackHole…").click());
	expect(dom.host.textContent).toContain("Installation couldn't start");
	expect(dom.capture).not.toHaveBeenCalled();
	await act(async () => button("Cancel").click());
	expect(
		dom.host.querySelector('section[aria-label="System audio setup"]'),
	).toBeNull();
	expect(element(".meeting-settings")).toBeDefined();
});
