import { Children, type DragEvent, isValidElement } from "react";
import { expect, it, vi } from "vitest";
import { WallpaperPlaylist } from "./WallpaperPlaylist";

vi.mock("react", async (load) => ({
	...(await load<typeof import("react")>()),
	useRef: (initial: unknown) => ({ current: initial }),
}));

it("ignores a drop on the source row and still dispatches a move to another row", () => {
	const move = vi.fn();
	const list = WallpaperPlaylist({
		items: ["a", "b"].map((id) => ({
			name: id,
			type: "image",
			format: "image/png",
			filePath: `media:${id.repeat(64)}`,
			duration: 5000,
		})),
		disabled: false,
		move,
		remove: () => {},
	});
	const rows = Children.toArray(list.props.children);
	const first = rows[0],
		second = rows[1];
	type Handlers = {
		onDragStart: (event: DragEvent<HTMLLIElement>) => void;
		onDrop: (event: DragEvent<HTMLLIElement>) => void;
	};
	if (!isValidElement<Handlers>(first) || !isValidElement<Handlers>(second))
		throw new Error("Missing playlist rows");
	const event = {
		preventDefault: vi.fn(),
		dataTransfer: { effectAllowed: "", setData: vi.fn() },
	} as unknown as DragEvent<HTMLLIElement>;
	first.props.onDragStart(event);
	first.props.onDrop(event);
	expect(move).not.toHaveBeenCalled();
	first.props.onDragStart(event);
	second.props.onDrop(event);
	expect(move.mock.calls).toEqual([[0, 1]]);
});
