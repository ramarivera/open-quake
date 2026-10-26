import { Schema } from "effect";
import {
	DEFAULT_WEATHER_SETTINGS,
	type MediaIntent,
	type WeatherMediaBridge,
	type WeatherMediaCommand,
	WeatherMediaReply,
	WeatherMediaSnapshot,
	type WeatherSettings,
} from "../../../shared/weather-media-contracts";

export class WeatherMediaClient {
	private state: WeatherMediaSnapshot | null = null;
	private listeners = new Set<() => void>();
	private off: (() => void) | undefined;
	private pending = Promise.resolve();
	private generation = 0;
	constructor(private readonly bridge: WeatherMediaBridge | undefined) {}
	getSnapshot = (): WeatherMediaSnapshot | null => this.state;
	private accept = (input: unknown): void => {
		if (!Schema.is(WeatherMediaSnapshot)(input)) return;
		const previous = this.state;
		this.state = !previous
			? input
			: {
					...(input.revision >= previous.revision ? input : previous),
					media:
						input.media.revision >= previous.media.revision
							? input.media
							: previous.media,
				};
		for (const listener of this.listeners) listener();
	};
	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		if (this.listeners.size === 1 && this.bridge) {
			const generation = ++this.generation;
			this.off = this.bridge.onSnapshot(this.accept);
			void this.request({ _tag: "read" }).then((reply) => {
				if (generation === this.generation && reply?._tag === "snapshot")
					this.accept(reply.snapshot);
			});
		}
		return () => {
			this.listeners.delete(listener);
			if (!this.listeners.size) {
				this.generation++;
				this.off?.();
				this.off = undefined;
			}
		};
	};
	request = async (
		command: WeatherMediaCommand,
	): Promise<WeatherMediaReply | null> => {
		if (!this.bridge) return null;
		const input: unknown = await this.bridge.request(command).catch(() => null);
		return Schema.is(WeatherMediaReply)(input) ? input : null;
	};
	/** One management writer; patches compose after the preceding commit. */
	configure = (patch: Partial<WeatherSettings>): Promise<boolean> => {
		let accepted = false;
		const operation = this.pending.then(async () => {
			const settings = {
				...(this.state?.settings ?? DEFAULT_WEATHER_SETTINGS),
				...patch,
			};
			const reply = await this.request({ _tag: "configure", settings });
			if (reply?._tag === "snapshot") {
				this.accept(reply.snapshot);
				accepted = true;
			}
		});
		this.pending = operation;
		return operation.then(() => accepted);
	};
	refresh = async (): Promise<boolean> => {
		const reply = await this.request({ _tag: "read" });
		if (reply?._tag !== "snapshot") return false;
		this.accept(reply.snapshot);
		return true;
	};
	control = async (intent: MediaIntent): Promise<boolean> => {
		const reply = await this.request({ _tag: "media", intent });
		if (reply?._tag === "control" && this.state)
			this.accept({ ...this.state, media: reply.media });
		// Always reconcile after control, including a rejected transport request.
		const current = await this.request({ _tag: "read" });
		if (current?._tag === "snapshot") this.accept(current.snapshot);
		return reply?._tag === "control" && reply.accepted;
	};
}
