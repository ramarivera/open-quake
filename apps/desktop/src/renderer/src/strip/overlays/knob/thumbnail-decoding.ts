import type { KnobModelSnapshot } from "../../../../../shared/knob-contracts";

/** Publish each decoded menu image separately; a replaced session cancels pending pixels. */
export function decodeKnobThumbnails(
    source: KnobModelSnapshot,
    publish: (snapshot: KnobModelSnapshot) => void,
    image: () => HTMLImageElement = () => new Image(),
): () => void {
    let active = true;
    let current: KnobModelSnapshot = { ...source, context: { ...source.context, profiles: source.context.profiles.map((profile) => ({ ...profile, thumbnail: { _tag: "missing" } })) } };
    publish(current);
    const images: HTMLImageElement[] = [];
    for (const profile of source.context.profiles) {
        if (profile.thumbnail._tag !== "ready") continue;
        const pixels = image();
        images.push(pixels);
        pixels.src = profile.thumbnail.dataUrl;
        void pixels.decode().then(() => {
            if (!active || pixels.naturalWidth === 0) return;
            current = { ...current, context: { ...current.context, profiles: current.context.profiles.map((entry) => entry.id === profile.id ? profile : entry) } };
            publish(current);
        }).catch(() => {});
    }
    return () => { active = false; for (const pixels of images) pixels.removeAttribute("src"); };
}
