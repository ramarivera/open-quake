import type { OpenQuakeBridge } from "../../../preload/quake";
import { type StripLayout, tileAt } from "./geometry";
import {
	createRegistrationSupervisor,
	createSubTouchRegistry,
	type RegistryEntry,
} from "./sub-touch-registry";
import {
	createStripTouchController,
	type StripKeyEvent,
	type TouchTile,
} from "./touch-controller";
import type { Rect } from "./touch-geometry";
import { clientToLogical, contains } from "./touch-geometry";
import { isEditableTouchTarget } from "./touch-gestures";

/** Grid owns tile hits; DOM observation supplies only in-tile sub-targets. */
export function mountStripTouch(
	root: HTMLElement,
	bridge: OpenQuakeBridge,
	rotation: number,
	layout: () => StripLayout | undefined,
	onKey?: (event: StripKeyEvent) => void,
	_onSlide?: (direction: 0 | 1 | 2 | 3) => void,
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
						const width = Math.max(
								44 * (Number(element.dataset.quakeTouchScale) || 1),
								bounds.width,
							),
							height = Math.max(
								44 * (Number(element.dataset.quakeTouchScale) || 1),
								bounds.height,
							);
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
						scale: Number(element.dataset.quakeTouchScale) || 1,
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
	const scanTargets = (): boolean => {
		for (const tile of root.querySelectorAll<HTMLElement>(
			'[data-state="tile"][data-key-code]',
		)) {
			if (!tile.querySelector("[data-quake-sub-touch]")) continue;
			const current = registry(tile);
			current.invalidate();
			current.resolve({ x: -1, y: -1 }, performance.now());
		}
		return root.querySelectorAll("[data-quake-sub-touch]").length > 0;
	};
	const registration = createRegistrationSupervisor({
		now: () => performance.now(),
		schedule: (action, delay) => {
			const timer = setTimeout(action, delay);
			return () => clearTimeout(timer);
		},
		request: scanTargets,
		globalRescan: scanTargets,
		change: (state) => {
			root.dataset.touchRegistration = state;
		},
	});
	registration.request();
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
	const owners = new Map<string, HTMLElement>();
	const controller = createStripTouchController({
		view: () => ({ width: 1920, height: 480, rotation }),
		layout,
		tileAt: (point, currentLayout): TouchTile | undefined => {
			const overlays = Array.from(
				root.querySelectorAll<HTMLElement>("[data-quake-overlay-touch]"),
			);
			const overlay = overlays.find((element) =>
				contains(logicalBounds(element), point),
			);
			if (overlay)
				return {
					keyCode: "knob-overlay",
					supportTouchEffect: false,
					subTargets: [
						{
							id: overlay.dataset.quakeSubTouch ?? "",
							bounds: logicalBounds(overlay),
							scrollable: false,
						},
					],
				};
			if (!currentLayout) return;
			const hit = tileAt(point, currentLayout);
			if (!hit) return;

			const element = Array.from(
				root.querySelectorAll<HTMLElement>(
					'[data-state="tile"][data-key-code]',
				),
			).find((element) => element.dataset.keyCode === hit.keyCode);
			if (!element) return hit;
			const sub = registry(element);
			const child = sub.resolve(point, performance.now());
			return {
				...hit,
				supportTouchEffect: child ? false : hit.supportTouchEffect,
				subTargets: sub.targets(),
			};
		},
		onTileTap: (keyCode) =>
			root.dispatchEvent(
				new CustomEvent("quake-strip-tile-tap", { detail: { keyCode } }),
			),
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
			registration.noteDispatch();
			const target = Array.from(
				detail.keyCode === "knob-overlay"
					? root.querySelectorAll<HTMLElement>("[data-quake-overlay-touch]")
					: (tile?.querySelectorAll<HTMLElement>("[data-quake-sub-touch]") ??
							[]),
			).find(
				(element) => element.dataset.quakeSubTouch === detail.subElementId,
			);
			const identity = `${detail.keyCode}/${detail.subElementId}`;
			if (detail.phase === "start" && target) owners.set(identity, target);
			const owner = owners.get(identity);
			if (detail.phase === "end") owners.delete(identity);
			if (!owner?.isConnected) return;
			owner.dispatchEvent(
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
	let disposed = false;
	let nativeUntil = 0;
	let clickUntil = 0;
	let domActive = false;
	let domEditable = false;
	let pointerId: number | undefined;
	let touchIdentifier: number | undefined;
	let ignoreContact = false;
	let nativeActive = false;
	let nativeDuplicatesDom = false;
	let vendorConnected = false;
	const reset = (): void => {
		controller.event({
			source: "mock",
			kind: "status",
			state: "disconnected",
			reason: "scope-closed",
		});
		onCancel?.();
		domActive = false;
		pointerId = undefined;
		touchIdentifier = undefined;
		ignoreContact = nativeActive;
	};
	const off = bridge.onQuakeEvent((event) => {
		if (disposed) return;
		if (event.kind === "touch") {
			vendorConnected = true;
			if (domActive || nativeDuplicatesDom) {
				nativeDuplicatesDom = event.points[0]?.action !== 0;
				return;
			}
			nativeActive = event.points[0]?.action !== 0;
			nativeUntil = performance.now() + 600;
			clickUntil = nativeUntil;
			if (ignoreContact) {
				if (event.points[0]?.action === 0) ignoreContact = false;
				return;
			}
		} else if (event.kind === "status") {
			vendorConnected = event.state === "connected";
			if (!vendorConnected) onCancel?.();
		}
		controller.event(event);
	});
	const domPoint = (x: number, y: number, action: 0 | 1): void => {
		const box = root.getBoundingClientRect();
		const point = clientToLogical(
			{ x, y },
			{ x: box.left, y: box.top, width: box.width, height: box.height },
			rotation,
		);
		const flipped = rotation === 90 || rotation === 180;
		controller.event(
			{
				source: "mock",
				kind: "touch",
				points: [
					{
						x: flipped ? 1920 - point.x : point.x,
						y: flipped ? point.y : 480 - point.y,
						action,
					},
				],
			},
			100,
		);
	};
	const pointer = (event: PointerEvent): void => {
		if (disposed) return;
		const panelTarget =
			event.target instanceof Node && root.contains(event.target);
		if (vendorConnected && (panelTarget || domActive)) {
			event.preventDefault();
			event.stopImmediatePropagation();
			return;
		}
		if (performance.now() < nativeUntil) return;
		if (event.type === "pointerdown") {
			if (
				domActive ||
				event.button !== 0 ||
				!(event.target instanceof Element) ||
				event.target.closest("[inert], :disabled")
			)
				return;
			const target = event.target.closest(
				".strip-slot, [data-quake-overlay-touch], .knob-tile-target",
			);
			if (!target) return;
			domActive = true;
			domEditable = isEditableTouchTarget(event.target);
			pointerId = event.pointerId;
		} else if (!domActive || event.pointerId !== pointerId) return;
		if (!domEditable) {
			event.preventDefault();
			event.stopPropagation();
		}
		clickUntil = performance.now() + 600;
		if (event.type === "pointercancel") reset();
		else
			domPoint(
				event.clientX,
				event.clientY,
				event.type === "pointerup" ? 0 : 1,
			);
		if (event.type === "pointerup" || event.type === "pointercancel") {
			domActive = false;
			pointerId = undefined;
		}
	};
	let lastPointer = Number.NEGATIVE_INFINITY;
	const pointerEvent = (event: PointerEvent): void => {
		lastPointer = performance.now();
		pointer(event);
	};
	const touch = (event: TouchEvent): void => {
		if (disposed) return;
		if (vendorConnected) {
			event.preventDefault();
			event.stopImmediatePropagation();
			return;
		}
		if (
			performance.now() - lastPointer < 600 ||
			performance.now() < nativeUntil
		)
			return;
		const point =
			event.type === "touchstart"
				? event.changedTouches[0]
				: Array.from(event.changedTouches).find(
						(point) => point.identifier === touchIdentifier,
					);
		if (!point) return;
		if (event.type === "touchstart") {
			if (
				domActive ||
				!(event.target instanceof Element) ||
				event.target.closest("[inert], :disabled") ||
				!event.target.closest(
					".strip-slot, [data-quake-overlay-touch], .knob-tile-target",
				)
			)
				return;
			domActive = true;
			domEditable = isEditableTouchTarget(event.target);
			touchIdentifier = point.identifier;
		} else if (!domActive) return;
		if (!domEditable) {
			event.preventDefault();
			event.stopPropagation();
		}
		clickUntil = performance.now() + 600;
		if (event.type === "touchcancel") reset();
		else
			domPoint(point.clientX, point.clientY, event.type === "touchend" ? 0 : 1);
		if (event.type === "touchend" || event.type === "touchcancel") {
			domActive = false;
			touchIdentifier = undefined;
		}
	};
	const click = (event: MouseEvent): void => {
		if (vendorConnected) {
			event.preventDefault();
			event.stopImmediatePropagation();
			return;
		}
		if (isEditableTouchTarget(event.target)) return;
		if (event.type === "dblclick" || performance.now() < clickUntil) {
			event.preventDefault();
			event.stopImmediatePropagation();
		}
	};
	const rescan = (): void => {
		for (const current of registries.values()) current.invalidate();
		refresh();
	};
	root.addEventListener("quake-strip-reset", reset);
	root.addEventListener("quake-touch-rescan", rescan);
	root.addEventListener("scroll", refresh, true);
	root.addEventListener("pointerdown", pointerEvent, true);
	for (const name of ["pointermove", "pointerup", "pointercancel"] as const)
		window.addEventListener(name, pointerEvent, true);
	for (const name of [
		"touchstart",
		"touchmove",
		"touchend",
		"touchcancel",
	] as const)
		root.addEventListener(name, touch, { capture: true, passive: false });
	root.addEventListener("click", click, true);
	root.addEventListener("dblclick", click, true);
	const dispose = (): void => {
		if (disposed) return;
		disposed = true;
		off();
		registration.dispose();
		resize.disconnect();
		mutation.disconnect();
		controller.dispose();
		onCancel?.();
		registries.clear();
		root.removeEventListener("quake-strip-reset", reset);
		root.removeEventListener("quake-touch-rescan", rescan);
		root.removeEventListener("scroll", refresh, true);
		root.removeEventListener("pointerdown", pointerEvent, true);
		for (const name of ["pointermove", "pointerup", "pointercancel"] as const)
			window.removeEventListener(name, pointerEvent, true);
		for (const name of [
			"touchstart",
			"touchmove",
			"touchend",
			"touchcancel",
		] as const)
			root.removeEventListener(name, touch, true);
		root.removeEventListener("click", click, true);
		root.removeEventListener("dblclick", click, true);
		window.removeEventListener("pagehide", dispose);
		window.removeEventListener("beforeunload", dispose);
	};
	window.addEventListener("pagehide", dispose);
	window.addEventListener("beforeunload", dispose);
	return dispose;
}
