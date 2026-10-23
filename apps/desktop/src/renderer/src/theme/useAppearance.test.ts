import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	APPEARANCE_STORAGE_KEY,
	type Appearance,
	defaultAppearance,
} from "./appearance";
import { persistAppearance, subscribeAppearance } from "./useAppearance";

class StorageChange extends Event {
	constructor(
		readonly key: string | null,
		readonly newValue: string | null,
	) {
		super("storage");
	}
}

class TestChannel {
	static instances: TestChannel[] = [];
	onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
	close = vi.fn();
	constructor(readonly name: string) {
		TestChannel.instances.push(this);
	}
}

describe("live appearance synchronization", () => {
	let target: EventTarget;
	let appearance: Appearance;
	let notice: string;
	let subscription: ReturnType<typeof subscribeAppearance>;

	beforeEach(() => {
		target = new EventTarget();
		vi.stubGlobal("window", target);
		vi.stubGlobal("BroadcastChannel", TestChannel);
		TestChannel.instances = [];
		appearance = { ...defaultAppearance, theme: "light", motion: "reduce" };
		notice = "";
		subscription = subscribeAppearance((next, message) => {
			appearance = next;
			notice = message;
		});
	});

	afterEach(() => {
		subscription.unsubscribe();
		vi.unstubAllGlobals();
	});

	it.each(["{", JSON.stringify({ ...defaultAppearance, version: 2 })])(
		"restores defaults and safe feedback in an open renderer for invalid storage %s",
		(value) => {
			target.dispatchEvent(new StorageChange(APPEARANCE_STORAGE_KEY, value));
			expect(appearance).toEqual(defaultAppearance);
			expect(notice).toBe("Saved appearance was invalid. Defaults restored.");
		},
	);

	it.each([APPEARANCE_STORAGE_KEY, null])(
		"restores defaults when preferences are removed or storage cleared: %s",
		(key) => {
			target.dispatchEvent(new StorageChange(key, null));
			expect(appearance).toEqual(defaultAppearance);
			expect(notice).toBe("");
		},
	);

	it("applies valid storage updates and ignores unrelated keys", () => {
		target.dispatchEvent(new StorageChange("unrelated", "{"));
		expect(appearance.theme).toBe("light");
		const next = { ...defaultAppearance, motion: "reduce" };
		target.dispatchEvent(
			new StorageChange(APPEARANCE_STORAGE_KEY, JSON.stringify(next)),
		);
		expect(appearance).toEqual(next);
		expect(notice).toBe("");
	});

	it("ignores invalid broadcasts while applying validated messages", () => {
		const channel = TestChannel.instances[0];
		expect(channel?.name).toBe(APPEARANCE_STORAGE_KEY);
		channel?.onmessage?.(new MessageEvent("message", { data: { version: 2 } }));
		expect(appearance.theme).toBe("light");
		channel?.onmessage?.(
			new MessageEvent("message", { data: defaultAppearance }),
		);
		expect(appearance).toEqual(defaultAppearance);
	});

	it("removes its storage listener and closes the channel on unsubscribe", () => {
		subscription.unsubscribe();
		target.dispatchEvent(new StorageChange(APPEARANCE_STORAGE_KEY, null));
		expect(appearance.theme).toBe("light");
		expect(TestChannel.instances[0]?.close).toHaveBeenCalledOnce();
	});
});

describe("appearance persistence", () => {
	const next: Appearance = { ...defaultAppearance, theme: "light" };

	it("broadcasts only after a successful storage write", () => {
		const setItem = vi.fn();
		const postMessage = vi.fn();
		expect(persistAppearance(next, { setItem }, { postMessage })).toBe("");
		expect(setItem).toHaveBeenCalledWith(
			APPEARANCE_STORAGE_KEY,
			JSON.stringify(next),
		);
		expect(postMessage).toHaveBeenCalledWith(next);
	});

	it("keeps an unsaved preference session-only and does not broadcast it", () => {
		const postMessage = vi.fn();
		const setItem = vi.fn(() => {
			throw new Error("quota");
		});
		expect(persistAppearance(next, { setItem }, { postMessage })).toBe(
			"Appearance could not be saved. Changes apply for this session.",
		);
		expect(postMessage).not.toHaveBeenCalled();
	});
});
