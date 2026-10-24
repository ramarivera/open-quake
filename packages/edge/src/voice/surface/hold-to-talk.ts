import { Option } from "effect";

/**
 * Hold-to-talk on aiChat/clawbot keys as one pure reducer. DK-Suite splits it
 * between the renderer (QSC:2121-2173, QSV:2895-2957) and main (BG@994936,
 * BG@1104082, BG@1109198); design.md "Hold-to-talk" has the merged table.
 */
export const HOLD_TIMING = {
	longPressMs: 1000,
	releaseGraceMs: 350,
	shortTapMs: 280,
	duplicateReleaseMs: 150,
} as const;

export type HoldKeyType = "aiChat" | "clawbot";
export interface HeldKey {
	readonly keyCode: string;
	readonly type: HoldKeyType;
	readonly agentId: Option.Option<string>;
	readonly downAt: number;
	readonly phase: "pressed" | "capturing";
	readonly generation: number;
	/** Set by a touch end; the release is due `releaseGraceMs` later. */
	readonly touchEndAt: Option.Option<number>;
}
export interface HoldState {
	/** The one reserved hold-to-talk key; others are busy while it is held. */
	readonly held: Option.Option<HeldKey>;
	readonly generation: number;
	readonly lastReleaseAt: ReadonlyMap<string, number>;
}
export const initialHoldState: HoldState = {
	held: Option.none(),
	generation: 0,
	lastReleaseAt: new Map(),
};

export type HoldInput =
	| {
			readonly _tag: "down";
			readonly keyCode: string;
			readonly type: HoldKeyType;
			readonly agentId: Option.Option<string>;
			readonly now: number;
			/** The key whose voice/chat flow is still running, from VoiceSurface. */
			readonly activeFlow: Option.Option<string>;
	  }
	| {
			readonly _tag: "touchEnd";
			readonly keyCode: string;
			readonly now: number;
	  }
	| {
			readonly _tag: "touchCancel";
			readonly keyCode: string;
			readonly now: number;
	  }
	| {
			readonly _tag: "up";
			readonly keyCode: string;
			readonly now: number;
			readonly voiceTouchEnd: boolean;
	  }
	| { readonly _tag: "tick"; readonly now: number }
	| { readonly _tag: "reset"; readonly now: number };

export type HoldEffect =
	| {
			readonly _tag: "select";
			readonly keyCode: string;
			readonly type: HoldKeyType;
			readonly agentId: Option.Option<string>;
	  }
	| {
			readonly _tag: "keyPress";
			readonly keyCode: string;
			readonly action: "down" | "up";
	  }
	| {
			readonly _tag: "startCapture";
			readonly keyCode: string;
			readonly generation: number;
			readonly type: HoldKeyType;
			readonly agentId: Option.Option<string>;
	  }
	| {
			readonly _tag: "release";
			readonly keyCode: string;
			readonly generation: number;
	  }
	| {
			readonly _tag: "cancelCapture";
			readonly keyCode: string;
			readonly generation: number;
	  }
	| { readonly _tag: "cancelFlow"; readonly keyCode: string }
	| { readonly _tag: "busy"; readonly keyCode: string };

export interface HoldStep {
	readonly state: HoldState;
	readonly effects: readonly HoldEffect[];
}

const longPressDue = (held: HeldKey): Option.Option<number> =>
	held.phase === "pressed"
		? Option.some(held.downAt + HOLD_TIMING.longPressMs)
		: Option.none();
const graceDue = (held: HeldKey): Option.Option<number> =>
	Option.map(held.touchEndAt, (at) => at + HOLD_TIMING.releaseGraceMs);

/** The earliest pending deadline, for the driver's single timer. */
export const nextDeadline = (state: HoldState): Option.Option<number> =>
	Option.flatMap(state.held, (held) => {
		const due = [longPressDue(held), graceDue(held)].flatMap((value) =>
			Option.isSome(value) ? [value.value] : [],
		);
		return due.length === 0 ? Option.none() : Option.some(Math.min(...due));
	});

/** Ends a press. `liftAt` is when the finger left, for the 280 ms short tap. */
function release(state: HoldState, held: HeldKey, liftAt: number): HoldStep {
	const freed = { ...state, held: Option.none() };
	const up: HoldEffect = {
		_tag: "keyPress",
		keyCode: held.keyCode,
		action: "up",
	};
	// Short tap or released before the long press: nothing was recorded, so
	// there is no voice release (QSV:2934, BG@994936).
	if (held.phase === "pressed" || liftAt - held.downAt < HOLD_TIMING.shortTapMs)
		return { state: freed, effects: [up] };
	const last = state.lastReleaseAt.get(held.keyCode);
	if (last !== undefined && liftAt - last < HOLD_TIMING.duplicateReleaseMs)
		return { state: freed, effects: [] };
	const lastReleaseAt = new Map(state.lastReleaseAt);
	lastReleaseAt.set(held.keyCode, liftAt);
	return {
		state: { ...freed, lastReleaseAt },
		effects: [
			{
				_tag: "release",
				keyCode: held.keyCode,
				generation: held.generation,
			},
			up,
		],
	};
}

function down(
	state: HoldState,
	input: Extract<HoldInput, { _tag: "down" }>,
): HoldStep {
	if (Option.isSome(state.held)) {
		const held = state.held.value;
		if (held.keyCode !== input.keyCode)
			return { state, effects: [{ _tag: "busy", keyCode: input.keyCode }] };
		// A down inside the grace means the finger never left (QSC:1985-1993).
		return Option.isSome(held.touchEndAt)
			? {
					state: {
						...state,
						held: Option.some({ ...held, touchEndAt: Option.none() }),
					},
					effects: [],
				}
			: { state, effects: [] };
	}
	if (Option.isSome(input.activeFlow))
		return input.activeFlow.value === input.keyCode
			? { state, effects: [{ _tag: "cancelFlow", keyCode: input.keyCode }] }
			: { state, effects: [{ _tag: "busy", keyCode: input.keyCode }] };
	const generation = state.generation + 1;
	return {
		state: {
			...state,
			generation,
			held: Option.some({
				keyCode: input.keyCode,
				type: input.type,
				agentId: input.agentId,
				downAt: input.now,
				phase: "pressed",
				generation,
				touchEndAt: Option.none(),
			}),
		},
		effects: [
			{
				_tag: "select",
				keyCode: input.keyCode,
				type: input.type,
				agentId: input.agentId,
			},
			{ _tag: "keyPress", keyCode: input.keyCode, action: "down" },
		],
	};
}

/** Fires every deadline at or before `now`, earliest first. */
function tick(state: HoldState, now: number): HoldStep {
	let current = state;
	const effects: HoldEffect[] = [];
	for (;;) {
		if (Option.isNone(current.held)) break;
		const held = current.held.value;
		const press = longPressDue(held);
		const grace = graceDue(held);
		const pressAt = Option.getOrElse(press, () => Number.POSITIVE_INFINITY);
		const graceAt = Option.getOrElse(grace, () => Number.POSITIVE_INFINITY);
		if (Math.min(pressAt, graceAt) > now) break;
		if (pressAt <= graceAt) {
			current = {
				...current,
				held: Option.some({ ...held, phase: "capturing" }),
			};
			effects.push({
				_tag: "startCapture",
				keyCode: held.keyCode,
				generation: held.generation,
				type: held.type,
				agentId: held.agentId,
			});
		} else {
			const step = release(
				current,
				held,
				Option.getOrElse(held.touchEndAt, () => now),
			);
			current = step.state;
			effects.push(...step.effects);
		}
	}
	return { state: current, effects };
}

const heldKey = (state: HoldState, keyCode: string): Option.Option<HeldKey> =>
	Option.filter(state.held, (held) => held.keyCode === keyCode);

export function stepHold(state: HoldState, input: HoldInput): HoldStep {
	// Deadlines that passed before this input happen first.
	const due = tick(state, input.now);
	const next = ((): HoldStep => {
		const current = due.state;
		switch (input._tag) {
			case "tick":
				return { state: current, effects: [] };
			case "down":
				return down(current, input);
			case "touchEnd":
				return Option.match(heldKey(current, input.keyCode), {
					onNone: () => ({ state: current, effects: [] }),
					onSome: (held) => ({
						state: {
							...current,
							held: Option.some({
								...held,
								touchEndAt: Option.some(input.now),
							}),
						},
						effects: [],
					}),
				});
			case "touchCancel":
				// touchcancel is not a release (QSC:2159-2172).
				return { state: current, effects: [] };
			case "up":
				// Ups without a real touch end are noise (QSV:2920-2932).
				if (!input.voiceTouchEnd) return { state: current, effects: [] };
				return Option.match(heldKey(current, input.keyCode), {
					onNone: () => ({ state: current, effects: [] }),
					onSome: (held) => release(current, held, input.now),
				});
			case "reset":
				return Option.match(current.held, {
					onNone: () => ({ state: current, effects: [] }),
					onSome: (held) => ({
						state: { ...current, held: Option.none() },
						effects:
							held.phase === "capturing"
								? [
										{
											_tag: "cancelCapture",
											keyCode: held.keyCode,
											generation: held.generation,
										},
									]
								: [],
					}),
				});
		}
	})();
	return { state: next.state, effects: [...due.effects, ...next.effects] };
}
