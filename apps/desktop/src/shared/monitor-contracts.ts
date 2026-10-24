import { Schema } from "effect";
import { SampleRate } from "../../../../packages/edge/src/monitor/monitor-contracts";

export {
	emptySnapshot,
	MonitorSnapshot,
} from "../../../../packages/edge/src/monitor/monitor-contracts";
export const STYLES = [
	"glass",
	"cyber",
	"anime",
	"tactical",
	"wasteland",
] as const;
export const StyleId = Schema.Literal(...STYLES);
export type StyleId = typeof StyleId.Type;
export const MediaSlot = Schema.Struct({
	id: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{32}$/)),
	kind: Schema.Literal("image", "video"),
	name: Schema.String,
});
export type MediaSlot = typeof MediaSlot.Type;
const slots = <A, I>(value: Schema.Schema<A, I>) =>
	Schema.Struct({
		glass: Schema.optionalWith(value, { exact: true }),
		cyber: Schema.optionalWith(value, { exact: true }),
		anime: Schema.optionalWith(value, { exact: true }),
		tactical: Schema.optionalWith(value, { exact: true }),
		wasteland: Schema.optionalWith(value, { exact: true }),
	});
export const MonitorSettings = Schema.Struct({
	styleId: StyleId,
	background: Schema.Literal("style", "none", "custom"),
	media: slots(MediaSlot),
	temperatureUnit: Schema.Literal("celsius", "fahrenheit"),
	enabled: Schema.Boolean,
	hz: SampleRate,
});
export type MonitorSettings = typeof MonitorSettings.Type;
export const defaults = (): MonitorSettings => ({
	styleId: "glass",
	background: "style",
	media: {},
	temperatureUnit: "celsius",
	enabled: true,
	hz: 1,
});
export const MonitorRecord = Schema.Struct({
	revision: Schema.NonNegativeInt,
	settings: MonitorSettings,
});
export type MonitorRecord = typeof MonitorRecord.Type;
export const MediaView = Schema.Struct({
	kind: Schema.Literal("image", "video"),
	url: Schema.String,
	available: Schema.Boolean,
});
export type MediaView = typeof MediaView.Type;
export const SettingsView = Schema.Struct({
	...MonitorRecord.fields,
	media: slots(MediaView),
	recovered: Schema.Boolean,
});
export type SettingsView = typeof SettingsView.Type;
export const MonitorCommand = Schema.Union(
	Schema.TaggedStruct("read", {
		styleId: Schema.optionalWith(StyleId, { exact: true }),
	}),
	Schema.TaggedStruct("save", {
		revision: Schema.NonNegativeInt,
		settings: MonitorSettings,
	}),
	Schema.TaggedStruct("chooseMedia", { styleId: StyleId }),
	Schema.TaggedStruct("watch", { active: Schema.Boolean }),
);
export type MonitorCommand = typeof MonitorCommand.Type;
export const MonitorReply = Schema.Union(
	Schema.TaggedStruct("success", { view: SettingsView }),
	Schema.TaggedStruct("media", { slot: MediaSlot, view: MediaView }),
	Schema.TaggedStruct("cancelled", {}),
	Schema.TaggedStruct("failure", {
		code: Schema.String,
		message: Schema.String,
	}),
);
export type MonitorReply = typeof MonitorReply.Type;
export const MONITOR_REQUEST = "monitor:request";
export const MONITOR_SETTINGS = "monitor:settings";
export const MONITOR_METRICS = "monitor:metrics";
export interface MonitorBridge {
	request(command: MonitorCommand): Promise<unknown>;
	onSettings(callback: (view: unknown) => void): () => void;
	onMetrics(callback: (snapshot: unknown) => void): () => void;
}
declare global {
	interface Window {
		quakeMonitor?: MonitorBridge;
	}
}
