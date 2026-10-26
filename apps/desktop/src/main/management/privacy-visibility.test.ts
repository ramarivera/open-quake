import { afterEach, expect, it, vi } from "vitest";
import { createPrivacyVisibility } from "./privacy-visibility";

afterEach(() => vi.useRealTimers());

it("SETTINGS-002 pins macOS settings through concurrent requests and the 1600ms handoff", () => {
	vi.useFakeTimers();
	const show = vi.fn();
	const owner = createPrivacyVisibility({ platform: "darwin", show });
	const first = owner.begin();
	const second = owner.begin();
	expect(owner.active()).toBe(true);
	expect(show).toHaveBeenCalledTimes(2);
	first();
	first();
	vi.advanceTimersByTime(2000);
	expect(owner.active()).toBe(true);
	second();
	vi.advanceTimersByTime(1599);
	expect(owner.active()).toBe(true);
	const third = owner.begin();
	vi.advanceTimersByTime(1);
	expect(owner.active()).toBe(true);
	third();
	vi.advanceTimersByTime(1600);
	expect(owner.active()).toBe(false);
	const late = owner.begin();
	late();
	owner.dispose();
	expect(owner.active()).toBe(false);
	expect(vi.getTimerCount()).toBe(0);
	owner.begin()();
	expect(show).toHaveBeenCalledTimes(4);
});

it.each(["linux", "win32"])(
	"SETTINGS-002 leaves %s window policy unchanged",
	(platform) => {
		const show = vi.fn();
		const owner = createPrivacyVisibility({ platform, show });
		owner.begin()();
		expect(owner.active()).toBe(false);
		expect(show).not.toHaveBeenCalled();
		owner.dispose();
	},
);
