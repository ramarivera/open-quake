// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import strings from "../../../shared/audio-setup-strings.json";
import { MeetingSettings } from "./MeetingSettings";
import { click, element, meetingDom } from "./meeting-test-fixture";

let dom: ReturnType<typeof meetingDom>;
afterEach(async () => {
	await dom?.close();
});
it.each(["en", "de"] as const)(
	"AI-283 %s mounted setup localizes consent, cancellation, failure and retry without capture",
	async (locale) => {
		const text = strings[locale];
		dom = meetingDom([], {}, locale);
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
		await dom.render(<MeetingSettings mock={false} />);
		const button = (text: string) => {
			const found = [
				...dom.host.querySelectorAll<HTMLButtonElement>("button"),
			].find((item) => item.textContent?.trim() === text);
			if (!found) throw new Error(text);
			return found;
		};
		await act(async () => button(text.title).click());
		expect(dom.host.textContent).toContain(text.warning);
		expect(dom.host.textContent).toContain(text.routing);
		expect(dom.host.textContent).toContain(text.missing);
		expect(button(text.install).disabled).toBe(true);
		expect(setup).toHaveBeenCalledTimes(1);
		setup.mockResolvedValueOnce({ platform: "darwin", state: "cancelled" });
		await click(`.meeting-audio-setup input[type="checkbox"]`);
		await act(async () => button(text.install).click());
		expect(dom.host.textContent).toContain(text.cancelled);
		expect(button(text.install).disabled).toBe(true);
		setup.mockResolvedValueOnce({ platform: "darwin", state: "failed" });
		await click(`.meeting-audio-setup input[type="checkbox"]`);
		await act(async () => button(text.install).click());
		expect(dom.host.textContent).toContain(text.failed);
		setup.mockResolvedValueOnce({ platform: "darwin", state: "storage-full" });
		await click('.meeting-audio-setup input[type="checkbox"]');
		await act(async () => button(text.install).click());
		expect(dom.host.textContent).toContain(text.storageFull);
		expect(button(text.install).disabled).toBe(true);
		let complete: (value: unknown) => void = () => {};
		setup.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					complete = resolve;
				}),
		);
		await click('.meeting-audio-setup input[type="checkbox"]');
		await act(async () => button(text.install).click());
		expect(button(text.opening).disabled).toBe(true);
		await act(async () => complete({ platform: "darwin", state: "opened" }));
		expect(dom.host.textContent).toContain(text.opened);
		expect(dom.host.textContent).toContain(text.retention);
		expect(dom.capture).not.toHaveBeenCalled();
		await act(async () => button(text.cancel).click());
		expect(dom.host.querySelector(".meeting-audio-setup")).toBeNull();
		expect(element(".meeting-settings")).toBeDefined();
	},
);
