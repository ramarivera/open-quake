import { Schema } from "effect";

export const MODULES = [
	"cpu",
	"gpu",
	"memory",
	"process",
	"disk",
	"network",
	"power",
] as const;
export const ModuleId = Schema.Literal(...MODULES);
export type ModuleId = typeof ModuleId.Type;
export const SampleRate = Schema.Finite.pipe(Schema.between(0.2, 10));
const number = Schema.Finite;
const optionalNumber = Schema.optionalWith(number, { exact: true });
export const Disk = Schema.Struct({
	name: Schema.String,
	size: optionalNumber,
	usedPercent: optionalNumber,
});
export type Disk = typeof Disk.Type;
/** Partial values are deliberate. Zero is a measurement, absence is unavailable. */
export const MetricValues = Schema.Struct({
	load: optionalNumber,
	temperature: optionalNumber,
	model: Schema.optionalWith(Schema.String, { exact: true }),
	total: optionalNumber,
	used: optionalNumber,
	free: optionalNumber,
	all: optionalNumber,
	running: optionalNumber,
	sleeping: optionalNumber,
	blocked: optionalNumber,
	disks: Schema.optionalWith(Schema.Array(Disk), { exact: true }),
	iface: Schema.optionalWith(Schema.String, { exact: true }),
	link: Schema.optionalWith(Schema.String, { exact: true }),
	up: optionalNumber,
	down: optionalNumber,
	hasBattery: Schema.optionalWith(Schema.Boolean, { exact: true }),
	charging: Schema.optionalWith(Schema.Boolean, { exact: true }),
	percent: optionalNumber,
});
export type MetricValues = typeof MetricValues.Type;
export const Availability = Schema.Literal(
	"available",
	"unsupported",
	"permission-denied",
	"error",
	"stale",
	"unavailable",
);
export const MetricSample = Schema.Struct({
	id: ModuleId,
	state: Availability,
	collectedAt: Schema.NonNegative,
	values: MetricValues,
});
export type MetricSample = typeof MetricSample.Type;
export const MonitorSnapshot = Schema.Struct({
	sampledAt: Schema.NonNegative,
	samples: Schema.Array(MetricSample),
});
export type MonitorSnapshot = typeof MonitorSnapshot.Type;
export const emptySnapshot = (): MonitorSnapshot => ({
	sampledAt: 0,
	samples: MODULES.map((id) => ({
		id,
		state: "unavailable",
		collectedAt: 0,
		values: {},
	})),
});
