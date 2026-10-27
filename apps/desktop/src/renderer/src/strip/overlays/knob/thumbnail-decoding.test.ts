// @vitest-environment happy-dom
import { expect, it } from "vitest";
import type { KnobModelSnapshot } from "../../../../../shared/knob-contracts";
import { decodeKnobThumbnails } from "./thumbnail-decoding";
it("SCREEN-097 prefetches every thumbnail, publishes decoded entries incrementally and cancels stale pixels", async () => {
    const source: KnobModelSnapshot = {
        context: { session: { deviceId: "preview", sessionId: "s1", profileId: "a", revision: 0 }, profiles: ["a", "b"].map((id) => ({ id, name: id, colorful: false, thumbnail: { _tag: "ready", dataUrl: "data:image/png;base64,YQ==" } })), keys: [], player: false },
        revision: 1, selector: { mode: "picker", index: 0, page: 0, progress: 0, ringVisible: false, direction: 1 }, focus: { _tag: "none" }, volume: { phase: "inactive", level: 0, muted: false }, notice: "",
    };
    const finish: (() => void)[] = [], images: HTMLImageElement[] = [], published: KnobModelSnapshot[] = [];
    const cancel = decodeKnobThumbnails(source, (value) => published.push(value), () => {
        const image = document.createElement("img"); images.push(image);
        Object.defineProperty(image, "naturalWidth", { value: 960 });
        image.decode = () => new Promise((resolve) => finish.push(resolve)); return image;
    });
    expect(images).toHaveLength(2);
    expect(published[0]?.context.profiles.every((p) => p.thumbnail._tag === "missing")).toBe(true);
    finish[0]?.(); await Promise.resolve();
    expect(published.at(-1)?.context.profiles.map((p) => p.thumbnail._tag)).toEqual(["ready", "missing"]);
    cancel(); finish[1]?.(); await Promise.resolve();
    expect(published).toHaveLength(2);
    expect(images.every((image) => !image.hasAttribute("src"))).toBe(true);
});
