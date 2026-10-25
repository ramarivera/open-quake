import t from "./strings.json";

export type HealthStatus =
	| "ready"
	| "unavailable"
	| "authenticationRequired"
	| "error"
	| "";

export const healthLabel = (status: HealthStatus): string =>
	status === ""
		? t.notTested
		: {
				ready: t.ready,
				unavailable: t.unreachable,
				authenticationRequired: t.authenticationRequired,
				error: t.healthError,
			}[status];

/** Status is always dot plus text; tone only reinforces the label. */
export const healthTone = (status: HealthStatus) =>
	status === "ready" ? "success" : status === "" ? "neutral" : "danger";
