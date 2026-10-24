import {
	WEATHER_REFRESH_MS,
	type WeatherResult,
} from "../../../shared/weather-media-contracts";

/** Visible subscription edge, independent of React and testable with a clock. */
export class WeatherRefresh {
	private debounce: ReturnType<typeof setTimeout> | undefined;
	private interval: ReturnType<typeof setInterval> | undefined;
	private retry: ReturnType<typeof setTimeout> | undefined;
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
		this.interval = setInterval(() => {
			if (this.visible()) this.schedule(0);
		}, WEATHER_REFRESH_MS);
	}
	changed(): void {
		this.version++;
		this.retried = false;
		clearTimeout(this.retry);
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
			if (result._tag === "error" && this.auto() && !this.retried) {
				this.retried = true;
				this.retry = setTimeout(() => void this.fetch(), 120_000);
			}
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
		clearInterval(this.interval);
		clearTimeout(this.retry);
	}
}
