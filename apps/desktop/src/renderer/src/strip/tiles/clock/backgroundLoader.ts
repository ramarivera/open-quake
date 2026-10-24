import type { MediaKind, ThemeId } from "../../../../../shared/clock-style";
import type { FlipTimers } from "./flipSequencer";

/** `DkClockBackground.vue`: custom media gets 5 s to load or start playing. */
export const MEDIA_LOAD_TIMEOUT_MS = 5000;

export interface ClockMediaSource {
	readonly kind: MediaKind;
	/** Opaque app URL; never a filesystem path. */
	readonly url: string;
}

export type BackgroundRequest =
	| { readonly kind: "none" }
	| {
			readonly kind: "theme";
			readonly themeId: ThemeId;
			readonly media?: ClockMediaSource | undefined;
	  };

export type EffectiveBackground =
	| { readonly kind: "none"; readonly generation: number }
	| {
			readonly kind: "builtin";
			readonly themeId: ThemeId;
			readonly generation: number;
	  }
	| {
			readonly kind: MediaKind;
			readonly themeId: ThemeId;
			readonly url: string;
			readonly generation: number;
	  };

/** What `apply` would draw first, for the very first render. */
export function initialBackground(
	request: BackgroundRequest,
): EffectiveBackground {
	if (request.kind === "none") return { kind: "none", generation: 0 };
	const { themeId, media } = request;
	return media
		? { kind: media.kind, themeId, url: media.url, generation: 0 }
		: { kind: "builtin", themeId, generation: 0 };
}

/**
 * What the L0 layer actually draws. Fallback only changes the drawing, never
 * the saved settings. Every applied request bumps the generation; media events
 * carry the generation they were rendered with, so late `load`/`error` events
 * from replaced media are ignored.
 */
export class BackgroundLoader {
	private generation = 0;
	private timer: unknown;
	private state: EffectiveBackground = { kind: "none", generation: 0 };

	constructor(
		private readonly onChange: (state: EffectiveBackground) => void,
		private readonly timers: FlipTimers = globalThis,
	) {}

	get current(): EffectiveBackground {
		return this.state;
	}

	apply(request: BackgroundRequest): void {
		this.clearTimer();
		const generation = ++this.generation;
		if (request.kind === "none") {
			this.emit({ kind: "none", generation });
			return;
		}
		const { themeId, media } = request;
		if (!media) {
			this.emit({ kind: "builtin", themeId, generation });
			return;
		}
		this.emit({ kind: media.kind, themeId, url: media.url, generation });
		this.timer = this.timers.setTimeout(() => {
			this.timer = undefined;
			if (generation === this.generation) this.fallback(generation);
		}, MEDIA_LOAD_TIMEOUT_MS);
	}

	/** Image `load` or video `playing`. */
	ready(generation: number): void {
		if (generation === this.generation) this.clearTimer();
	}

	/** Any media error. A refused `play()` is left to the 5 s timeout. */
	failed(generation: number): void {
		if (generation !== this.generation) return;
		this.clearTimer();
		this.fallback(generation);
	}

	dispose(): void {
		this.generation++;
		this.clearTimer();
	}

	private fallback(generation: number): void {
		const state = this.state;
		if (state.kind === "none" || state.kind === "builtin") return;
		this.emit({ kind: "builtin", themeId: state.themeId, generation });
	}

	private clearTimer(): void {
		if (this.timer !== undefined) {
			this.timers.clearTimeout(this.timer);
			this.timer = undefined;
		}
	}

	private emit(state: EffectiveBackground): void {
		this.state = state;
		this.onChange(state);
	}
}
