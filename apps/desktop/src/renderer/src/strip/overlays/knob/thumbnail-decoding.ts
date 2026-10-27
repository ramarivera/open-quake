import type { KnobModelSnapshot } from "../../../../../shared/knob-contracts";

/** One bounded decoder per mounted picker. Progress frames reuse pending/decoded pixels. */
export function knobThumbnailDecoder(
	publish: (snapshot: KnobModelSnapshot) => void,
	image: () => HTMLImageElement = () => new Image(),
) {
	type Entry = { source: string; pixels: HTMLImageElement; ready: boolean };
	const entries = new Map<string, Entry>();
	let current: KnobModelSnapshot | undefined;
	let session = "";
	let active = true;
	const clear = () => {
		for (const entry of entries.values()) entry.pixels.removeAttribute("src");
		entries.clear();
	};
	const emit = () => {
		if (!active || !current) return;
		publish({
			...current,
			context: {
				...current.context,
				profiles: current.context.profiles.map((profile) => {
					const entry = entries.get(profile.id);
					return profile.thumbnail._tag !== "ready" ||
						(entry?.ready && entry.source === profile.thumbnail.dataUrl)
						? profile
						: { ...profile, thumbnail: { _tag: "missing" } };
				}),
			},
		});
	};
	return {
		accept(source: KnobModelSnapshot) {
			if (!active) return;
			const nextSession = JSON.stringify([
				source.context.session.deviceId,
				source.context.session.sessionId,
			]);
			if (session !== nextSession) {
				clear();
				session = nextSession;
			}
			current = source;
			const wanted = new Map(
				source.context.profiles
					.slice(0, 30)
					.flatMap((profile) =>
						profile.thumbnail._tag === "ready"
							? [[profile.id, profile.thumbnail.dataUrl] as const]
							: [],
					),
			);
			for (const [id, entry] of entries) {
				if (wanted.get(id) !== entry.source) {
					entry.pixels.removeAttribute("src");
					entries.delete(id);
				}
			}
			for (const [id, dataUrl] of wanted) {
				if (entries.has(id)) continue;
				const pixels = image();
				const entry: Entry = { source: dataUrl, pixels, ready: false };
				entries.set(id, entry);
				pixels.src = dataUrl;
				void pixels
					.decode()
					.then(() => {
						if (
							!active ||
							entries.get(id) !== entry ||
							pixels.naturalWidth === 0
						)
							return;
						entry.ready = true;
						emit();
					})
					.catch(() => {});
			}
			emit();
		},
		dispose() {
			active = false;
			current = undefined;
			clear();
		},
	};
}

export function decodeKnobThumbnails(
	source: KnobModelSnapshot,
	publish: (snapshot: KnobModelSnapshot) => void,
	image?: () => HTMLImageElement,
): () => void {
	const decoder = knobThumbnailDecoder(publish, image);
	decoder.accept(source);
	return () => decoder.dispose();
}
