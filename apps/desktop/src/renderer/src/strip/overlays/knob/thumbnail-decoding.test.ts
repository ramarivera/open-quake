// @vitest-environment happy-dom
import { expect, it } from "vitest";
import type { KnobModelSnapshot } from "../../../../../shared/knob-contracts";
import {
	decodeKnobThumbnails,
	knobThumbnailDecoder,
} from "./thumbnail-decoding";

it("SCREEN-097 prefetches every thumbnail, publishes decoded entries incrementally and cancels stale pixels", async () => {
	const source: KnobModelSnapshot = {
		context: {
			session: {
				deviceId: "preview",
				sessionId: "s1",
				profileId: "a",
				revision: 0,
			},
			profiles: ["a", "b"].map((id) => ({
				id,
				name: id,
				colorful: false,
				thumbnail: { _tag: "ready", dataUrl: "data:image/png;base64,YQ==" },
			})),
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
	const finish: (() => void)[] = [],
		images: HTMLImageElement[] = [],
		published: KnobModelSnapshot[] = [];
	const cancel = decodeKnobThumbnails(
		source,
		(value) => published.push(value),
		() => {
			const image = document.createElement("img");
			images.push(image);
			Object.defineProperty(image, "naturalWidth", { value: 960 });
			image.decode = () => new Promise((resolve) => finish.push(resolve));
			return image;
		},
	);
	expect(images).toHaveLength(2);
	expect(
		published[0]?.context.profiles.every((p) => p.thumbnail._tag === "missing"),
	).toBe(true);
	finish[0]?.();
	await Promise.resolve();
	expect(
		published.at(-1)?.context.profiles.map((p) => p.thumbnail._tag),
	).toEqual(["ready", "missing"]);
	cancel();
	finish[1]?.();
	await Promise.resolve();
	expect(published).toHaveLength(2);
	expect(images.every((image) => !image.hasAttribute("src"))).toBe(true);
});

it("SCREEN-097 reuses pending and decoded images across frames, invalidates changed sources and cancels session pixels", async () => {
	const source: KnobModelSnapshot = {
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
					name: "a",
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
	const finish: (() => void)[] = [],
		images: HTMLImageElement[] = [],
		published: KnobModelSnapshot[] = [];
	const decoder = knobThumbnailDecoder(
		(value) => published.push(value),
		() => {
			const pixels = document.createElement("img");
			images.push(pixels);
			Object.defineProperty(pixels, "naturalWidth", { value: 960 });
			pixels.decode = () => new Promise((resolve) => finish.push(resolve));
			return pixels;
		},
	);
	decoder.accept(source);
	decoder.accept({
		...source,
		revision: 2,
		selector: { ...source.selector, progress: 0.5 },
	});
	expect(images).toHaveLength(1);
	finish[0]?.();
	await Promise.resolve();
	expect(published.at(-1)?.revision).toBe(2);
	expect(published.at(-1)?.context.profiles[0]?.thumbnail._tag).toBe("ready");
	decoder.accept({ ...source, revision: 3 });
	expect(published.at(-1)?.context.profiles[0]?.thumbnail._tag).toBe("ready");
	decoder.accept({
		...source,
		revision: 4,
		context: {
			...source.context,
			profiles: source.context.profiles.map((p) => ({
				...p,
				thumbnail: { _tag: "ready", dataUrl: "data:image/png;base64,Yg==" },
			})),
		},
	});
	expect(images[0]?.hasAttribute("src")).toBe(false);
	expect(images).toHaveLength(2);
	decoder.accept({
		...source,
		revision: 5,
		context: {
			...source.context,
			session: { ...source.context.session, sessionId: "s2" },
		},
	});
	expect(images[1]?.hasAttribute("src")).toBe(false);
	const count = published.length;
	finish[1]?.();
	await Promise.resolve();
	expect(published).toHaveLength(count);
	finish[2]?.();
	await Promise.resolve();
	expect(published.at(-1)?.context.session.sessionId).toBe("s2");
	decoder.accept({
		...source,
		revision: 6,
		context: {
			...source.context,
			profiles: Array.from({ length: 31 }, (_, i) => ({
				id: `bounded-${i}`,
				name: String(i),
				colorful: false,
				thumbnail: {
					_tag: "ready" as const,
					dataUrl: "data:image/png;base64,YQ==",
				},
			})),
		},
	});
	expect(images).toHaveLength(33); // Three replaced/session images, then at most thirty current entries.
	expect(images[2]?.hasAttribute("src")).toBe(false);
	decoder.dispose();
	expect(images.every((image) => !image.hasAttribute("src"))).toBe(true);
});
