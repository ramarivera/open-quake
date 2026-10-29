import { clientToLogical, type Point } from "../../touch-geometry";
import { type PickerTarget, pickerTarget, sameTarget } from "./geometry";

/** One gesture consumer for normalized physical touch and desktop pointers. */
export function mountPickerTouch(
	root: HTMLElement,
	picker: HTMLElement,
	count: number,
	page: number,
	select: (target: PickerTarget) => void,
	pressed: (index: number) => void,
	targetAt: (x: number, y: number) => PickerTarget = (x, y) =>
		pickerTarget(count, page, x, y),
): () => void {
	let down: PickerTarget | undefined;
	let cancelled = false;
	let pointer: number | undefined;
	const point = (position: Point, action: 0 | 1): void => {
		const target = targetAt(position.x, position.y);
		if (action === 1) {
			if (!down) {
				down = target;
				cancelled = false;
				pressed(target.kind === "card" ? target.index : -1);
			} else if (!sameTarget(down, target)) {
				cancelled = true;
				pressed(-1);
			}
		} else {
			const start = down;
			down = undefined;
			pressed(-1);
			if (start && !cancelled && sameTarget(start, target)) select(start);
		}
	};
	const physical = (event: Event): void => {
		if (!(event instanceof CustomEvent)) return;
		const detail: unknown = event.detail;
		if (
			typeof detail !== "object" ||
			detail === null ||
			!("x" in detail) ||
			typeof detail.x !== "number" ||
			!("y" in detail) ||
			typeof detail.y !== "number" ||
			!("action" in detail) ||
			(detail.action !== 0 && detail.action !== 1)
		)
			return;
		point({ x: detail.x, y: detail.y }, detail.action);
	};
	const position = (event: PointerEvent): Point => {
		const bounds = root.getBoundingClientRect();
		return clientToLogical(
			{ x: event.clientX, y: event.clientY },
			{
				x: bounds.left,
				y: bounds.top,
				width: bounds.width,
				height: bounds.height,
			},
			Number(new URLSearchParams(window.location.search).get("rotation") ?? 0),
		);
	};
	const start = (event: PointerEvent): void => {
		if (pointer !== undefined || !event.isPrimary || event.button !== 0) return;
		pointer = event.pointerId;
		point(position(event), 1);
		picker.setPointerCapture(event.pointerId);
	};
	const move = (event: PointerEvent): void => {
		if (pointer === event.pointerId) point(position(event), 1);
	};
	const end = (event: PointerEvent): void => {
		if (pointer !== event.pointerId) return;
		pointer = undefined;
		point(position(event), 0);
	};
	const cancel = (): void => {
		pointer = undefined;
		down = undefined;
		pressed(-1);
	};
	root.dataset.stripOverlay = "true";
	root.addEventListener("quake-strip-overlay-touch", physical);
	picker.addEventListener("pointerdown", start);
	picker.addEventListener("pointermove", move);
	picker.addEventListener("pointerup", end);
	picker.addEventListener("pointercancel", cancel);
	return () => {
		delete root.dataset.stripOverlay;
		root.removeEventListener("quake-strip-overlay-touch", physical);
		picker.removeEventListener("pointerdown", start);
		picker.removeEventListener("pointermove", move);
		picker.removeEventListener("pointerup", end);
		picker.removeEventListener("pointercancel", cancel);
	};
}
