import { useEffect, useRef, useState } from "react";
import { createEmojiAssetCache } from "./asset-cache";

const cache = createEmojiAssetCache((input) => {
	const bridge = window.quakeEmoji;
	return bridge
		? bridge.request(input)
		: Promise.resolve({
				_tag: "failure",
				code: "unavailable",
				message: "Emoji library unavailable",
			});
});

export function useEmojiAsset(hash: string): string {
	const [asset, setAsset] = useState({ hash: "", source: "" });
	useEffect(() => {
		let active = true;
		void cache
			.load(hash)
			.then((source) => {
				if (active) setAsset({ hash, source });
			})
			.catch(() => {});
		return () => {
			active = false;
		};
	}, [hash]);
	return asset.hash === hash ? asset.source : "";
}

/** Gallery entries request bytes only when they approach their scroll viewport. */
export function EmojiImage({
	hash,
	alt,
}: {
	hash: string;
	alt: string;
}): React.JSX.Element {
	const image = useRef<HTMLImageElement>(null);
	const [visible, setVisible] = useState(false);
	const source = useEmojiAsset(visible ? hash : "");
	useEffect(() => {
		const element = image.current;
		if (!element) return;
		const observer = new IntersectionObserver(
			(entries) => {
				setVisible(entries.some((entry) => entry.isIntersecting));
			},
			{ rootMargin: "128px" },
		);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	return <img ref={image} src={source || undefined} alt={alt} />;
}
