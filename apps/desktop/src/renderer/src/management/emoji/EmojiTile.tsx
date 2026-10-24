import { useEffect, useState } from "react";
import type { StripTileProps } from "../../strip/tileRegistry";
import { GenericTile } from "../../strip/tiles/GenericTile";
/** Saved keys pin an immutable hash, including GIFs removed from the package. */
export function EmojiTile(props: StripTileProps): React.JSX.Element {
	const hash = props.tile.key.config.icon.startsWith("emoji:")
		? props.tile.key.config.icon.slice(6)
		: "";
	const [source, setSource] = useState("");
	useEffect(() => {
		let active = true;
		setSource("");
		if (/^[a-f0-9]{64}$/.test(hash))
			void window.quakeEmoji
				?.request({ type: "asset", hash })
				.then((reply) => {
					if (active && reply._tag === "ready")
						setSource(reply.assets[hash] ?? "");
				})
				.catch(() => {});
		return () => {
			active = false;
		};
	}, [hash]);
	const icon = props.tile.key.config.icon.startsWith("emoji:")
		? source
		: props.tile.key.config.icon;
	return (
		<div
			data-emoji-asset-state={icon ? "ready" : hash ? "loading" : "empty"}
			style={{ display: "contents" }}
		>
			<GenericTile
				{...props}
				tile={{
					...props.tile,
					key: {
						...props.tile.key,
						config: { ...props.tile.key.config, icon },
					},
				}}
			/>
		</div>
	);
}
