import { Schema } from "effect";
import { toSafeDiagnosticCause } from "../../../../packages/device/src/device-errors";

export const WeatherErrors = {
	WeatherRequestTimedOut: {
		code: "QUAKE.WEATHER.REQUEST_TIMED_OUT",
		category: "dependency",
		message: "Weather request timed out",
		policy: { userFacing: true, userRecoverable: true, retry: "automatic" },
	},
	WeatherNetworkFailed: {
		code: "QUAKE.WEATHER.NETWORK_FAILED",
		category: "dependency",
		message: "Weather unavailable",
		policy: { userFacing: true, userRecoverable: true, retry: "automatic" },
	},
	WeatherResponseInvalid: {
		code: "QUAKE.WEATHER.RESPONSE_INVALID",
		category: "dependency",
		message: "Weather response is invalid",
		policy: { userFacing: false, userRecoverable: true, retry: "automatic" },
	},
	WeatherPersistenceFailed: {
		code: "QUAKE.WEATHER.PERSISTENCE_FAILED",
		category: "dependency",
		message: "Weather settings could not be saved",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
} as const;
const fields = <const C extends string, const M extends string>(entry: {
	code: C;
	category: "dependency";
	message: M;
}) => ({
	code: Schema.Literal(entry.code),
	category: Schema.Literal(entry.category),
	message: Schema.Literal(entry.message),
});
const retain = <T extends object>(error: T, cause: unknown): T => {
	Object.defineProperty(error, "originalCause", {
		value: cause,
		enumerable: false,
	});
	Object.defineProperty(error, "diagnosticCause", {
		value: toSafeDiagnosticCause(cause),
		enumerable: true,
	});
	return error;
};
export class WeatherNetworkFailed extends Schema.TaggedError<WeatherNetworkFailed>()(
	"WeatherNetworkFailed",
	fields(WeatherErrors.WeatherNetworkFailed),
) {
	declare readonly originalCause: unknown;
	static fromCause(cause: unknown): WeatherNetworkFailed {
		return retain(
			new WeatherNetworkFailed(WeatherErrors.WeatherNetworkFailed),
			cause,
		);
	}
}
export class WeatherRequestTimedOut extends Schema.TaggedError<WeatherRequestTimedOut>()(
	"WeatherRequestTimedOut",
	fields(WeatherErrors.WeatherRequestTimedOut),
) {
	declare readonly originalCause: unknown;
	static fromCause(cause: unknown): WeatherRequestTimedOut {
		return retain(
			new WeatherRequestTimedOut(WeatherErrors.WeatherRequestTimedOut),
			cause,
		);
	}
}
export class WeatherResponseInvalid extends Schema.TaggedError<WeatherResponseInvalid>()(
	"WeatherResponseInvalid",
	fields(WeatherErrors.WeatherResponseInvalid),
) {
	declare readonly originalCause: unknown;
	static fromCause(cause: unknown): WeatherResponseInvalid {
		return retain(
			new WeatherResponseInvalid(WeatherErrors.WeatherResponseInvalid),
			cause,
		);
	}
}
export class WeatherPersistenceFailed extends Schema.TaggedError<WeatherPersistenceFailed>()(
	"WeatherPersistenceFailed",
	fields(WeatherErrors.WeatherPersistenceFailed),
) {
	declare readonly originalCause: unknown;
	static fromCause(cause: unknown): WeatherPersistenceFailed {
		return retain(
			new WeatherPersistenceFailed(WeatherErrors.WeatherPersistenceFailed),
			cause,
		);
	}
}
export type WeatherFetchError =
	| WeatherNetworkFailed
	| WeatherResponseInvalid
	| WeatherRequestTimedOut;
