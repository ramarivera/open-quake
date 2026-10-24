/** `DkFlipClock.vue`: each flip phase lasts 0.38 s. */
export const FLIP_PHASE_MS = 380;

export type FlipPhase = "rest" | "turn-on" | "turn-down";
export interface FlipState {
	/** Digit drawn on the upper flap; lags the lower half during phase 1. */
	readonly upper: number;
	readonly phase: FlipPhase;
}

export interface FlipTimers {
	setTimeout(callback: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
}

/**
 * The minute-ones flip: the old upper half falls away (turn-on), then the new
 * one drops into place (turn-down). A change mid-flip restarts from the
 * previously shown value, as DK-Suite's watcher does. Framework-free so the
 * timing is testable with fake timers.
 */
export class FlipSequencer {
	private state: FlipState;
	private current: number;
	private handle: unknown;
	private disposed = false;

	constructor(
		initial: number,
		private readonly onChange: (state: FlipState) => void,
		private readonly timers: FlipTimers = globalThis,
	) {
		this.current = initial;
		this.state = { upper: initial, phase: "rest" };
	}

	get snapshot(): FlipState {
		return this.state;
	}

	set(next: number, reducedMotion: boolean): void {
		if (this.disposed || next === this.current) return;
		const previous = this.current;
		this.current = next;
		this.clear();
		if (reducedMotion) {
			this.emit({ upper: next, phase: "rest" });
			return;
		}
		this.emit({ upper: previous, phase: "turn-on" });
		this.handle = this.timers.setTimeout(() => {
			this.emit({ upper: next, phase: "turn-down" });
			this.handle = this.timers.setTimeout(() => {
				this.handle = undefined;
				this.emit({ upper: next, phase: "rest" });
			}, FLIP_PHASE_MS);
		}, FLIP_PHASE_MS);
	}

	dispose(): void {
		this.disposed = true;
		this.clear();
	}

	private clear(): void {
		if (this.handle !== undefined) {
			this.timers.clearTimeout(this.handle);
			this.handle = undefined;
		}
	}

	private emit(state: FlipState): void {
		this.state = state;
		this.onChange(state);
	}
}
