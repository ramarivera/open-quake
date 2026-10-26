import { Schema } from "effect";
import {
	MODULES,
	ModuleId,
	MonitorSnapshot,
	SampleRate,
} from "./monitor-contracts.js";

export const MetricSelection = Schema.Array(ModuleId).pipe(
	Schema.maxItems(MODULES.length),
	Schema.filter((ids) => new Set(ids).size === ids.length),
);
export const AppMonitoring = Schema.Struct({ enabled: Schema.Boolean });
export const MonitoringOverride = Schema.Struct({
	active: Schema.Boolean,
	hz: SampleRate,
	metrics: MetricSelection,
});
export const MonitoringConfig = Schema.Struct({
	enabled: Schema.Boolean,
	hz: SampleRate,
	metrics: MetricSelection,
	method: Schema.Literal("native"),
	appMonitor: AppMonitoring,
	override: MonitoringOverride,
});
export type MonitoringConfig = typeof MonitoringConfig.Type;
export const monitoringDefaults = (): MonitoringConfig => ({
	enabled: true,
	hz: 1,
	metrics: [...MODULES],
	method: "native",
	appMonitor: { enabled: false },
	override: { active: false, hz: 1, metrics: ["cpu"] },
});
/** Overlay reads the latest saved normal config. It never writes profiles or hotkeys. */
export const effectiveMonitoring = (config: MonitoringConfig) => ({
	enabled: config.enabled,
	hz: config.override.active ? config.override.hz : config.hz,
	metrics: config.enabled
		? MODULES.filter((id) =>
				(config.override.active
					? config.override.metrics
					: config.metrics
				).includes(id),
			)
		: [],
	appEnabled: config.enabled && config.appMonitor.enabled,
});
export const ForegroundWindow = Schema.Struct({
	id: Schema.String.pipe(Schema.maxLength(1024)),
	path: Schema.String.pipe(Schema.maxLength(32768)),
});
export type ForegroundWindow = typeof ForegroundWindow.Type;
export const ForegroundSnapshot = Schema.Struct({
	state: Schema.Literal(
		"disabled",
		"unavailable",
		"available",
		"permission-denied",
		"error",
		"unsupported",
	),
	collectedAt: Schema.NonNegative,
	window: Schema.optionalWith(ForegroundWindow, { exact: true }),
});
export type ForegroundSnapshot = typeof ForegroundSnapshot.Type;

export const MonitoringSnapshot = Schema.Struct({
	metrics: MonitorSnapshot,
	foreground: ForegroundSnapshot,
});
export type MonitoringSnapshot = typeof MonitoringSnapshot.Type;
