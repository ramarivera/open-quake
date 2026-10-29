// @vitest-environment happy-dom
import { act, createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { KnobModelSnapshot } from "../../../../../shared/knob-contracts";
import { mount } from "../../../management/dom-test";
import { useKnob } from "./useKnob";

afterEach(() => {
	Reflect.deleteProperty(window, "quakeKnob");
	vi.useRealTimers();
});
it("SCREEN-097 mounted picker reuses decodes during progress, rejects old revisions, drops failed/stale pixels and cancels on unmount", async () => {
	vi.useFakeTimers();
	const images: HTMLImageElement[] = [];
	const pending: { resolve: () => void; reject: () => void }[] = [];
	const NativeImage = globalThis.Image;
	vi.stubGlobal(
		"Image",
		class extends NativeImage {
			constructor() {
				super();
				images.push(this);
				Object.defineProperty(this, "naturalWidth", { value: 960 });
				this.decode = () =>
					new Promise<void>((resolve, reject) =>
						pending.push({
							resolve,
							reject: () => reject(new Error("bad pixels")),
						}),
					);
			}
		},
	);

	const initial: KnobModelSnapshot = {
		context: {
			session: {
				deviceId: "preview",
				sessionId: "s1",
				profileId: "a",
				revision: 0,
			},
			profiles: [
				{
					id: "a",
					name: "A",
					colorful: false,
					thumbnail: { _tag: "ready", dataUrl: "data:image/png;base64,YQ==" },
				},
			],
			keys: [],
			player: false,
		},
		revision: 1,
		selector: {
			mode: "picker",
			index: 0,
			page: 0,
			progress: 0,
			ringVisible: false,
			direction: 1,
		},
		focus: { _tag: "none" },
		volume: { phase: "inactive", level: 0, muted: false },
		notice: "",
	};
	let receive: (snapshot: KnobModelSnapshot) => void = () => {};
	const off = vi.fn();
	Object.defineProperty(window, "quakeKnob", {
		configurable: true,
		value: {
			onSnapshot: (fn: typeof receive) => {
				receive = fn;
				return off;
			},
			request: async () => ({ _tag: "success", snapshot: initial }),
		},
	});
	function Picker() {
		const { snapshot } = useKnob();
		return createElement("output", null, JSON.stringify(snapshot));
	}
	const mounted = await mount(createElement(Picker));
	const current = () =>
		JSON.parse(mounted.host.textContent ?? "") as KnobModelSnapshot;
	const flush = async () => {
		await act(async () => {
			await Promise.resolve();
			await vi.advanceTimersByTimeAsync(16);
		});
	};
	await flush();
	expect(images).toHaveLength(1);
	expect(current().context.profiles[0]?.thumbnail._tag).toBe("missing");
	await act(async () =>
		receive({
			...initial,
			revision: 2,
			selector: { ...initial.selector, progress: 0.5 },
		}),
	);
	pending[0]?.resolve();
	await flush();
	expect(images).toHaveLength(1);
	expect(current()).toMatchObject({
		revision: 2,
		selector: { progress: 0.5 },
		context: { profiles: [{ thumbnail: { _tag: "ready" } }] },
	});
	await act(async () => receive(initial));
	await flush();
	expect(current().revision).toBe(2);
	const session = {
		...initial,
		revision: 3,
		context: {
			...initial.context,
			session: { ...initial.context.session, sessionId: "s2" },
		},
	};
	await act(async () => receive(session));
	pending[1]?.reject();
	await flush();
	expect(images[0]?.hasAttribute("src")).toBe(false);
	expect(current().context.profiles[0]?.thumbnail._tag).toBe("missing");
	await act(async () =>
		receive({
			...session,
			revision: 4,
			context: {
				...session.context,
				profiles: [
					{
						id: "a",
						name: "A",
						colorful: false,
						thumbnail: { _tag: "ready", dataUrl: "data:image/png;base64,Yg==" },
					},
				],
			},
		}),
	);
	await mounted.unmount();
	pending[2]?.resolve();
	await flush();
	expect(off).toHaveBeenCalledOnce();
	expect(images.every((image) => !image.hasAttribute("src"))).toBe(true);
});
it("expires repeated request-failure notices and cancels timers on unmount", async () => {
	vi.useFakeTimers();
	Object.defineProperty(window, "quakeKnob", {
		configurable: true,
		value: {
			onSnapshot: () => () => {},
			request: async () => ({
				_tag: "failure",
				code: "QUAKE.KNOB.CAPABILITY_UNAVAILABLE",
			}),
		},
	});
	let fail: (() => Promise<void>) | undefined;
	function Notice() {
		const { notice, request } = useKnob();
		fail = () => request({ _tag: "ToggleVolume", sessionId: "s1" });
		return createElement("output", null, notice);
	}
	const mounted = await mount(createElement(Notice));
	await act(async () => fail?.());
	expect(mounted.host.textContent).toBe("This control is unavailable");
	await act(async () => vi.advanceTimersByTimeAsync(2000));
	await act(async () => fail?.());
	await act(async () => vi.advanceTimersByTimeAsync(1500));
	expect(mounted.host.textContent).toBe("This control is unavailable");
	await act(async () => vi.advanceTimersByTimeAsync(1500));
	expect(mounted.host.textContent).toBe("");
	await act(async () => fail?.());
	await mounted.unmount();
	expect(vi.getTimerCount()).toBe(0);
});
