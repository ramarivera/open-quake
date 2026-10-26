import {
	addVelocitySample,
	clamp,
	dragOffset,
	isVerticalScroll,
	MIN_FLING,
	scrollVelocity,
	stepInertia,
	stepRubberBack,
	stopFling,
	type VelocitySample,
} from "../../scroll-physics";

/** Native scroll owns the range; translated content paints bounded elastic displacement. */
export function mountDiskScroll(element: HTMLElement): () => void {
	const content = element.firstElementChild;
	const original =
		content instanceof HTMLElement ? content.style.transform : "";
	const range = () => Math.max(0, element.scrollHeight - element.clientHeight);
	const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
	let frame = 0;
	let offset = element.scrollTop;
	let origin = offset;
	let active = false;
	let admitted = false;
	let samples: readonly VelocitySample[] = [];
	const refresh = () =>
		element.dispatchEvent(
			new CustomEvent("quake-touch-rescan", { bubbles: true }),
		);
	const paint = (value: number): void => {
		offset = value;
		const bounded = clamp(value, 0, range());
		element.scrollTop = bounded;
		if (content instanceof HTMLElement)
			content.style.transform = `translateY(${bounded - value}px)`;
	};
	const stop = (): void => {
		cancelAnimationFrame(frame);
		frame = 0;
	};
	const finish = (): void => {
		stop();
		paint(clamp(offset, 0, range()));
		refresh();
	};
	const release = (cancelled: boolean): void => {
		active = false;
		if (cancelled || reduced() || !admitted) {
			finish();
			return;
		}
		const start = performance.now();
		if (offset < 0 || offset > range()) {
			const from = offset;
			const tick = (time: number): void => {
				const step = stepRubberBack(from, range(), time - start);
				paint(step.offset);
				if (step.done || reduced()) finish();
				else frame = requestAnimationFrame(tick);
			};
			frame = requestAnimationFrame(tick);
			return;
		}
		let velocity = scrollVelocity(samples);
		if (
			start - (samples.at(-1)?.time ?? start) > 80 ||
			Math.abs(velocity) < MIN_FLING
		) {
			finish();
			return;
		}
		let previous = start;
		const tick = (time: number): void => {
			if (stopFling(time - start, velocity) || reduced()) {
				finish();
				return;
			}
			const step = stepInertia(velocity, time - previous);
			previous = time;
			velocity = step.velocity;
			paint(clamp(offset + step.distance, 0, range()));
			if (offset <= 0 || offset >= range()) finish();
			else frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
	};
	const touch = (event: Event): void => {
		if (!(event instanceof CustomEvent)) return;
		const d: unknown = event.detail;
		if (
			typeof d !== "object" ||
			d === null ||
			!("x" in d) ||
			!("y" in d) ||
			!("startX" in d) ||
			!("startY" in d) ||
			typeof d.x !== "number" ||
			typeof d.y !== "number" ||
			typeof d.startX !== "number" ||
			typeof d.startY !== "number"
		)
			return;
		const now = performance.now();
		if ("phase" in d && d.phase === "start") {
			stop();
			paint(clamp(element.scrollTop, 0, range()));
			origin = element.scrollTop;
			active = true;
			admitted = false;
			samples = [{ offset: origin, time: now }];
		} else if (event.type === "quake-sub-touch-end") {
			if (active)
				release(
					"cancelled" in d
						? d.cancelled === true
						: !("isEffective" in d) || d.isEffective !== true,
				);
		} else if (active) {
			admitted ||= isVerticalScroll(d.x - d.startX, d.y - d.startY);
			if (!admitted) return;
			paint(dragOffset(origin, d.y - d.startY, range()));
			samples = addVelocitySample(samples, { offset, time: now });
		}
	};
	element.addEventListener("quake-sub-touch-start", touch);
	element.addEventListener("quake-sub-touch-end", touch);
	return () => {
		stop();
		active = false;
		if (content instanceof HTMLElement) content.style.transform = original;
		element.removeEventListener("quake-sub-touch-start", touch);
		element.removeEventListener("quake-sub-touch-end", touch);
	};
}
