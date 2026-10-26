import { useRef } from "react";
import type { DisplayMedia } from "../../../shared/display";

/** Drag reordering has equivalent focusable move buttons. No preview can make sound. */
export function WallpaperPlaylist({
	items,
	disabled,
	move,
	remove,
}: {
	items: readonly DisplayMedia[];
	disabled: boolean;
	move: (from: number, to: number) => void;
	remove: (index: number) => void;
}): React.JSX.Element {
	const dragging = useRef<number | undefined>(undefined);
	return (
		<ol className="wallpaper-playlist" aria-label="Wallpaper playlist">
			{items.map((item, index) => (
				<li
					key={item.filePath}
					draggable={!disabled}
					onDragStart={(event) => {
						dragging.current = index;
						event.dataTransfer.effectAllowed = "move";
						event.dataTransfer.setData("text/plain", item.filePath);
					}}
					onDragEnd={() => {
						dragging.current = undefined;
					}}
					onDragOver={(event) => {
						if (!disabled) event.preventDefault();
					}}
					onDrop={(event) => {
						event.preventDefault();
						if (
							!disabled &&
							dragging.current !== undefined &&
							dragging.current !== index
						)
							move(dragging.current, index);
						dragging.current = undefined;
					}}
				>
					<span className="wallpaper-track-name">{item.name}</span>
					<div className="button-row">
						<button
							type="button"
							className="button"
							aria-label={`Move ${item.name} up`}
							disabled={disabled || index === 0}
							onClick={() => move(index, index - 1)}
						>
							Move up
						</button>
						<button
							type="button"
							className="button"
							aria-label={`Move ${item.name} down`}
							disabled={disabled || index === items.length - 1}
							onClick={() => move(index, index + 1)}
						>
							Move down
						</button>
						<button
							type="button"
							className="button"
							aria-label={`Remove ${item.name}`}
							disabled={disabled}
							onClick={() => remove(index)}
						>
							Remove
						</button>
					</div>
				</li>
			))}
		</ol>
	);
}
