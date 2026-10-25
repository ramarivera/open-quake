import { describe, expect, it, vi } from "vitest";
import { subscribeGeneralRefresh } from "./general-refresh";
import { createGeneralStore } from "./stores";
import { fakeBridge, general } from "./test-fixtures";

async function tick() {
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
function events() {
	return {
		window: new EventTarget(),
		document: Object.assign(new EventTarget(), { visibilityState: "visible" }),
	};
}

describe("General settings OS readback lifecycle", () => {
	it("refreshes external changes on focus and visibility, then disposes listeners", async () => {
		let enabled = false;
		const bridge = fakeBridge({ loginStatus: vi.fn(async () => enabled) });
		const store = createGeneralStore(bridge);
		const e = events();
		const stop = subscribeGeneralRefresh(store, e.window, e.document);
		await tick();
		expect(store.getState().login).toEqual({ status: "known", enabled: false });
		enabled = true;
		e.window.dispatchEvent(new Event("focus"));
		await tick();
		expect(store.getState().login).toEqual({ status: "known", enabled: true });
		e.document.visibilityState = "hidden";
		e.document.dispatchEvent(new Event("visibilitychange"));
		await tick();
		expect(bridge.loginStatus).toHaveBeenCalledTimes(2);
		enabled = false;
		e.document.visibilityState = "visible";
		e.document.dispatchEvent(new Event("visibilitychange"));
		await tick();
		expect(store.getState().login).toEqual({ status: "known", enabled: false });
		stop();
		e.window.dispatchEvent(new Event("focus"));
		e.document.dispatchEvent(new Event("visibilitychange"));
		await tick();
		expect(bridge.loginStatus).toHaveBeenCalledTimes(3);
	});
	it("defers a return during a save and retains the explicit OS refusal", async () => {
		let release = (): void => {};
		const refusal = {
			code: "QUAKE.SETTINGS.OS_APPLY_FAILED",
			reason: "denied",
		};
		const bridge = fakeBridge({
			saveGeneral: vi.fn(
				() =>
					new Promise<never>((_, reject) => {
						release = () => reject(refusal);
					}),
			),
			general: vi.fn(async () => general({ revision: 2, launchAtLogin: true })),
		});
		const store = createGeneralStore(bridge);
		const e = events();
		const stop = subscribeGeneralRefresh(store, e.window, e.document);
		await tick();
		const save = store.set("launchAtLogin", true);
		e.window.dispatchEvent(new Event("focus"));
		expect(bridge.loginStatus).toHaveBeenCalledTimes(1);
		release();
		expect(await save).toBe(false);
		await tick();
		expect(bridge.loginStatus).toHaveBeenCalledTimes(3);
		expect(store.getState()).toMatchObject({
			login: { status: "known", enabled: false },
			failure: { field: "launchAtLogin", failure: refusal },
		});
		stop();
	});
});
