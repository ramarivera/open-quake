import { Schema } from "effect";
import {
	AppMonitoring,
	MetricSelection,
	MonitoringOverride,
	monitoringDefaults,
} from "../../../../packages/edge/src/monitor/monitor-config";
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
	gameModeMonitorConfig: Schema.optionalWith(Schema.Unknown, { exact: true }),
	styleId: StyleId,
	background: Schema.Literal("style", "none", "custom"),
	media: slots(MediaSlot),
	temperatureUnit: Schema.Literal("celsius", "fahrenheit"),
	enabled: Schema.Boolean,
	hz: SampleRate,
	metrics: Schema.optionalWith(MetricSelection, {
		default: () => monitoringDefaults().metrics,
	}),
	method: Schema.optionalWith(Schema.Literal("native"), {
		default: () => "native" as const,
	}),
	appMonitor: Schema.optionalWith(AppMonitoring, {
		default: () => monitoringDefaults().appMonitor,
	}),
	override: Schema.optionalWith(MonitoringOverride, {
		default: () => monitoringDefaults().override,
	}),
});
export type MonitorSettings = typeof MonitorSettings.Type;
export const defaults = (): MonitorSettings => ({
	...monitoringDefaults(),
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
	Schema.TaggedStruct("artwork", {}),
	Schema.TaggedStruct("read", {
		styleId: Schema.optionalWith(StyleId, { exact: true }),
	}),
	Schema.TaggedStruct("save", {
		revision: Schema.NonNegativeInt,
		settings: MonitorSettings,
	}),
	Schema.TaggedStruct("chooseMedia", { styleId: StyleId }),
	Schema.TaggedStruct("resolveMedia", { slot: MediaSlot }),
	Schema.TaggedStruct("watch", { active: Schema.Boolean }),
);
export type MonitorCommand = typeof MonitorCommand.Type;
export const ForegroundArtwork = Schema.Struct({ artwork: Schema.String });
export type ForegroundArtwork = typeof ForegroundArtwork.Type;
export const MONITOR_ARTWORK = "monitor:artwork";
export const MonitorReply = Schema.Union(
	Schema.TaggedStruct("foregroundArtwork", ForegroundArtwork.fields),
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
export const MONITOR_STATE_REQUEST = "monitor:state:request";
export const MONITOR_STATE = "monitor:state";
export { MonitoringSnapshot } from "../../../../packages/edge/src/monitor/monitor-config";
export const MONITOR_METRICS = "monitor:metrics";
export interface MonitorBridge {
	request(command: MonitorCommand): Promise<unknown>;
	snapshot(): Promise<unknown>;
	onSettings(callback: (view: unknown) => void): () => void;
	onArtwork?(callback: (artwork: unknown) => void): () => void;
	onState(callback: (snapshot: unknown) => void): () => void;
	onMetrics(callback: (snapshot: unknown) => void): () => void;
}
declare global {
	interface Window {
		quakeMonitor?: MonitorBridge;
	}
}
