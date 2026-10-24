import {
	WEATHER_REFRESH_MS,
	type WeatherResult,
} from "../../../shared/weather-media-contracts";

/** Visible subscription edge, independent of React and testable with a clock. */
export class WeatherRefresh {
	private debounce: ReturnType<typeof setTimeout> | undefined;
	private running = false;
	private pending = false;
	private disposed = false;
	private version = 0;
	private retried = false;
	constructor(
		private readonly load: () => Promise<WeatherResult>,
		private readonly publish: (result: WeatherResult | "loading") => void,
		private readonly visible: () => boolean,
		private readonly auto: () => boolean,
	) {
		this.schedule(800);
	}
	changed(): void {
		this.version++;
		this.retried = false;
		this.schedule(50);
	}
	visibilityChanged(): void {
		if (this.visible()) this.schedule(50);
	}
	private schedule(ms: number): void {
		clearTimeout(this.debounce);
		if (!this.disposed) this.debounce = setTimeout(() => void this.fetch(), ms);
	}
	private async fetch(): Promise<void> {
		if (this.disposed || !this.visible()) return;
		if (this.running) {
			this.pending = true;
			return;
		}
		this.running = true;
		const version = this.version;
		this.publish("loading");
		const result = await this.load().catch(
			(): WeatherResult => ({ _tag: "error", reason: "unavailable" }),
		);
		this.running = false;
		if (this.disposed) return;
		if (version === this.version) {
			this.publish(result);
			let next =
				result._tag === "ready" ? result.refreshAfterMs : WEATHER_REFRESH_MS;
			if (result._tag === "ready") this.retried = false;
			if (result._tag === "error" && this.auto() && !this.retried) {
				this.retried = true;
				next = 120_000;
			}
			this.schedule(next);
		}
		if (this.pending || version !== this.version) {
			this.pending = false;
			this.schedule(50);
		}
	}
	dispose(): void {
		this.disposed = true;
		this.version++;
		clearTimeout(this.debounce);
	}
}
