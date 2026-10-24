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
import { normalizeTouch } from "./touch-geometry";
import { createGestureRecognizer } from "./touch-gestures";

/** Grid owns tile hits; DOM observation supplies only in-tile sub-targets. */
export function mountStripTouch(
	root: HTMLElement,
	bridge: OpenQuakeBridge,
	rotation: number,
	layout: () => StripLayout | undefined,
	onKey?: (event: StripKeyEvent) => void,
	onSlide?: (direction: 0 | 1 | 2 | 3) => void,
	onCancel?: () => void,
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
	let gestureActive = false,
		gestureStarted = false,
		dx = 0,
		dy = 0;
	const gesture = createGestureRecognizer({
		width: 1920,
		height: 480,
		onMove: (move) => {
			dx += move.dx;
			dy += move.dy;
			if (Math.hypot(dx, dy) > 16) onCancel?.();
		},
		onEnd: (event) =>
			onSlide?.(
				event.axis === "horizontal"
					? event.dx > 0
						? 0
						: 1
					: event.dy > 0
						? 2
						: 3,
			),
	});
	const off = bridge.onQuakeEvent((event) => {
		if (root.dataset.stripOverlay === "true") {
			onCancel?.();
			gesture.cancel();
			gestureActive = false;
			// Ownership lasts until lift, even if the picker closes mid-contact.
			if (event.kind === "touch" && event.points[0]?.action !== 0)
				gestureStarted = true;
		}
		if (event.kind === "touch" && event.points[0]) {
			const first = event.points[0],
				point = normalizeTouch(first, { width: 1920, height: 480, rotation });
			if (first.action !== 0) {
				if (!gestureStarted) {
					gestureStarted = true;
					dx = 0;
					dy = 0;
					const current = layout();
					const tile = current ? tileAt(point, current) : undefined;
					gestureActive =
						root.dataset.stripOverlay !== "true" &&
						!tile?.hasTouchableSubElements;
				}
				if (gestureActive) gesture.point(point, performance.now());
			} else {
				if (gestureActive) gesture.end(point, performance.now());
				gestureActive = false;
				gestureStarted = false;
			}
		} else if (event.kind === "status" && event.state !== "connected") {
			onCancel?.();
			gesture.cancel();
			gestureActive = false;
			gestureStarted = false;
		}
		controller.event(event);
	});
	return () => {
		onCancel?.();
		off();
		resize.disconnect();
		mutation.disconnect();
		registries.clear();
		gesture.cancel();
		controller.dispose();
	};
}
