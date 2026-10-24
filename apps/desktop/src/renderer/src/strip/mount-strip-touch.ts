import type { OpenQuakeBridge } from "../../../preload/quake";
import { type StripLayout, tileAt } from "./geometry";
import {
	createSubTouchRegistry,
	type RegistryEntry,
} from "./sub-touch-registry";
import {
	createStripTouchController,
	type StripKeyEvent,
	type TouchTile,
} from "./touch-controller";
import type { Rect } from "./touch-geometry";

/** Grid owns tile hits; DOM observation supplies only in-tile sub-targets. */
export function mountStripTouch(
	root: HTMLElement,
	bridge: OpenQuakeBridge,
	rotation: number,
	layout: () => StripLayout | undefined,
	onKey?: (event: StripKeyEvent) => void,
): () => void {
	const logicalBounds = (element: Element): Rect => {
		const box = element.getBoundingClientRect(),
			host = root.getBoundingClientRect();
		if (rotation === 90)
			return {
				x: ((box.top - host.top) * 1920) / host.height,
				y: 480 - ((box.right - host.left) * 480) / host.width,
				width: (box.height * 1920) / host.height,
				height: (box.width * 480) / host.width,
			};
		return {
			x: ((box.left - host.left) * 1920) / host.width,
			y: ((box.top - host.top) * 480) / host.height,
			width: (box.width * 1920) / host.width,
			height: (box.height * 480) / host.height,
		};
	};
	const registries = new Map<
		Element,
		ReturnType<typeof createSubTouchRegistry>
	>();
	const registry = (tile: Element) => {
		let current = registries.get(tile);
		if (!current) {
			current = createSubTouchRegistry(() =>
				Array.from(
					tile.querySelectorAll<HTMLElement>("[data-quake-sub-touch]"),
				).map((element): RegistryEntry => {
					const liveBounds = (): Rect => {
						const bounds = logicalBounds(element);
						const width = Math.max(44, bounds.width),
							height = Math.max(44, bounds.height);
						return {
							x: bounds.x - (width - bounds.width) / 2,
							y: bounds.y - (height - bounds.height) / 2,
							width,
							height,
						};
					};
					return {
						id: element.dataset.quakeSubTouch ?? "",
						scrollable: element.dataset.supportQuakeMove === "true",
						bounds: liveBounds(),
						liveBounds,
						connected: () => element.isConnected,
					};
				}),
			);
			registries.set(tile, current);
		}
		return current;
	};
	const refresh = (): void => {
		for (const [tile, current] of registries) {
			if (!tile.isConnected) registries.delete(tile);
			else current.refresh();
		}
	};
	const resize = new ResizeObserver(refresh);
	resize.observe(root);
	const mutation = new MutationObserver((records) => {
		for (const [tile, current] of registries) {
			if (
				records.some(
					(record) =>
						(tile === record.target || tile.contains(record.target)) &&
						(record.type === "childList" ||
							record.attributeName === "data-quake-sub-touch" ||
							record.attributeName === "data-support-quake-move"),
				)
			)
				current.invalidate();
		}
		refresh();
	});
	mutation.observe(root, {
		subtree: true,
		childList: true,
		attributes: true,
		attributeFilter: [
			"style",
			"class",
			"data-quake-sub-touch",
			"data-support-quake-move",
		],
	});
	const controller = createStripTouchController({
		view: () => ({ width: 1920, height: 480, rotation }),
		layout,
		tileAt: (point, currentLayout): TouchTile | undefined => {
			if (!currentLayout) return;
			const hit = tileAt(point, currentLayout);
			if (!hit) return;
			if (!hit.hasTouchableSubElements) return hit;
			const element = Array.from(
				root.querySelectorAll<HTMLElement>(
					'[data-state="tile"][data-key-code]',
				),
			).find((element) => element.dataset.keyCode === hit.keyCode);
			if (!element) return hit;
			const sub = registry(element);
			sub.resolve(point, performance.now());
			return { ...hit, subTargets: sub.targets() };
		},
		onKey: (detail) => {
			onKey?.(detail);
			root.dispatchEvent(new CustomEvent("quake-strip-key", { detail }));
		},
		onSubTouch: (detail) => {
			const tile = Array.from(
				root.querySelectorAll<HTMLElement>(
					'[data-state="tile"][data-key-code]',
				),
			).find((element) => element.dataset.keyCode === detail.keyCode);
			const target = Array.from(
				tile?.querySelectorAll<HTMLElement>("[data-quake-sub-touch]") ?? [],
			).find(
				(element) => element.dataset.quakeSubTouch === detail.subElementId,
			);
			target?.dispatchEvent(
				new CustomEvent(
					detail.phase === "end"
						? "quake-sub-touch-end"
						: "quake-sub-touch-start",
					{ detail },
				),
			);
		},
		overlay: {
			active: () => root.dataset.stripOverlay === "true",
			point: (point, action) =>
				root.dispatchEvent(
					new CustomEvent("quake-strip-overlay-touch", {
						detail: { ...point, action },
					}),
				),
		},
		now: () => performance.now(),
		schedule: (action, delay) => {
			const timer = setTimeout(action, delay);
			return () => clearTimeout(timer);
		},
	});
	const off = bridge.onQuakeEvent(controller.event);
	return () => {
		off();
		resize.disconnect();
		mutation.disconnect();
		registries.clear();
		controller.dispose();
	};
}
