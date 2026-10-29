import { Option, Schema } from "effect";

const Point = Schema.Struct({
	x: Schema.Int.pipe(Schema.between(0, 65535)),
	y: Schema.Int.pipe(Schema.between(0, 65535)),
	action: Schema.Literal(0, 1),
});
export const GuidedInput = Schema.Union(
	Schema.Struct({
		kind: Schema.Literal("touch"),
		points: Schema.Array(Point).pipe(Schema.maxItems(5)),
	}),
	Schema.Struct({
		kind: Schema.Literal("rotate"),
		direction: Schema.Literal(-1, 1),
	}),
	Schema.Struct({ kind: Schema.Literal("press"), state: Schema.Literal(0, 1) }),
	Schema.Struct({
		kind: Schema.Literal("status"),
		state: Schema.Literal("connected", "disconnected"),
	}),
);
type Input = typeof GuidedInput.Type;
type Event = Input & { readonly t: number; readonly step: string };
export const GUIDED_STEPS = [
	{
		id: "center",
		prompt: "Tap and release the center touch tile.",
		goal: "tap",
	},
	{ id: "left", prompt: "Turn the knob left by five clicks.", goal: "left" },
	{ id: "right", prompt: "Turn the knob right by five clicks.", goal: "right" },
	{
		id: "press",
		prompt: "Briefly press and release the knob three times.",
		goal: "press",
	},
	{
		id: "top-left",
		prompt: "Tap and release the top-left touch tile.",
		goal: "tap",
	},
	{
		id: "top-right",
		prompt: "Tap and release the top-right touch tile.",
		goal: "tap",
	},
	{
		id: "bottom-right",
		prompt: "Tap and release the bottom-right touch tile.",
		goal: "tap",
	},
	{
		id: "bottom-left",
		prompt: "Tap and release the bottom-left touch tile.",
		goal: "tap",
	},
	{
		id: "swipe",
		prompt: "Swipe one finger across the screen, then lift it.",
		goal: "swipe",
	},
	{ id: "unplug", prompt: "Unplug the QUAKE USB cable.", goal: "disconnected" },
	{ id: "replug", prompt: "Reconnect the QUAKE USB cable.", goal: "connected" },
	{
		id: "after",
		prompt: "Tap and release a touch tile after reconnecting.",
		goal: "tap",
	},
] as const;
export type GuidedStepId = (typeof GUIDED_STEPS)[number]["id"];
export const GuidedArrival = Schema.Struct({
	event: GuidedInput,
	at: Schema.Number.pipe(Schema.finite(), Schema.nonNegative()),
	step: Schema.optional(Schema.Literal(...GUIDED_STEPS.map((step) => step.id))),
});

/** Observes requested sequences; it never infers physical target accuracy. */
export function createGuidedCapture(now: () => number, limit = 10000) {
	const began = now();
	const events: Event[] = [];
	const steps: { id: string; status: "observed" | "timed-out"; ms: number }[] =
		[];
	let index = 0;
	let from = 0;
	let stepBegan = began;
	let stopped = "";
	const tapped = (mine: readonly Event[]) => {
		const phases = mine.flatMap((e) =>
			e.kind === "touch" ? e.points.slice(0, 1).map((p) => p.action) : [],
		);
		const down = phases.indexOf(1);
		return down >= 0 && phases.slice(down + 1).includes(0);
	};
	const swiped = (mine: readonly Event[]) => {
		let start: { x: number; y: number } | undefined;
		let moved = false;
		for (const event of mine) {
			if (event.kind !== "touch") continue;
			if (event.points.filter((point) => point.action === 1).length > 1) {
				start = undefined;
				moved = false;
				continue;
			}
			// End the previous contact before beginning its replacement, regardless
			// of the device's point order in a mixed release/press frame.
			for (const point of [...event.points].sort(
				(a, b) => a.action - b.action,
			)) {
				if (point.action === 1) {
					if (!start) start = point;
					else if (point.x !== start.x || point.y !== start.y) moved = true;
				} else {
					if (start && moved) return true;
					start = undefined;
					moved = false;
				}
			}
		}
		return false;
	};
	const current = () => GUIDED_STEPS[index];
	const tick = () => {
		if (!current() || stopped) return;
		if (
			now() - began > 8 * 60000 ||
			now() - stepBegan > (current()?.goal === "connected" ? 90000 : 60000)
		) {
			steps.push({
				id: current()?.id ?? "",
				status: "timed-out",
				ms: Math.round(now() - stepBegan),
			});
			stopped = "A requested input sequence timed out.";
		}
	};
	return {
		current,
		tick,
		stop(reason: "aborted" | "buffer-overflow") {
			stopped = reason;
		},
		accept(
			raw: unknown,
			at = now(),
			shownStep: GuidedStepId | null = current()?.id ?? null,
		) {
			tick();
			const step = current();
			if (!step || stopped) return;
			if (!Number.isFinite(at) || at < began || at > now()) return;
			const parsed = Schema.decodeUnknownOption(GuidedInput)(raw);
			if (Option.isNone(parsed)) return;
			if (events.length >= Math.min(10000, Math.max(1, limit))) {
				stopped = "Event limit reached.";
				return;
			}
			events.push({
				...parsed.value,
				t: Math.round(at - began),
				step: shownStep ?? "unprompted",
			});
			if (shownStep !== step.id) return;
			const mine = events.slice(from).filter((event) => event.step === step.id);
			const turns = mine.reduce(
				(sum, e) => sum + (e.kind === "rotate" ? e.direction : 0),
				0,
			);
			const presses = mine.flatMap((e) =>
				e.kind === "press" ? [e.state] : [],
			);
			const done =
				step.goal === "tap"
					? tapped(mine)
					: step.goal === "left"
						? turns <= -5
						: step.goal === "right"
							? turns >= 5
							: step.goal === "press"
								? presses.filter(
										(state, i) => i > 0 && state === 0 && presses[i - 1] === 1,
									).length >= 3
								: step.goal === "swipe"
									? swiped(mine)
									: mine.some(
											(e) => e.kind === "status" && e.state === step.goal,
										);
			if (done) {
				steps.push({
					id: step.id,
					status: "observed",
					ms: Math.round(now() - stepBegan),
				});
				index++;
				from = events.length;
				stepBegan = now();
			}
		},
		acceptBatch(
			batch: readonly {
				event: unknown;
				at: number;
				step?: GuidedStepId | undefined;
			}[],
			dropped: number,
		) {
			for (const arrival of batch)
				this.accept(arrival.event, arrival.at, arrival.step ?? null);
			if (dropped > 0) this.stop("buffer-overflow");
		},
		snapshot() {
			tick();
			return {
				version: 1,
				status: stopped ? "incomplete" : current() ? "recording" : "observed",
				reason: stopped,
				physicalAccepted: false,
				coordinateSpace: "vendor-raw",
				steps: [...steps],
				events: [...events],
			};
		},
	};
}
