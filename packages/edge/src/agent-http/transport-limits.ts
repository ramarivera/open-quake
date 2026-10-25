import { RuntimeConnectionInvalid } from "./runtime-errors.js";
import type {
	RuntimeHttpLimits,
	RuntimeHttpResponse,
} from "./runtime-ports.js";
export const DEFAULT_HTTP_LIMITS = {
	timeoutMs: 60_000,
	maxResponseBytes: 16 * 1024 * 1024,
	maxErrorBytes: 16 * 1024,
	maxEventBytes: 256 * 1024,
} as const;
export type Limits = Required<RuntimeHttpLimits>;
export const responseLimits = new WeakMap<RuntimeHttpResponse, Limits>();
export const checkedLimits = (input: RuntimeHttpLimits): Limits => {
	const limits = {
		timeoutMs: input.timeoutMs ?? DEFAULT_HTTP_LIMITS.timeoutMs,
		maxResponseBytes:
			input.maxResponseBytes ?? DEFAULT_HTTP_LIMITS.maxResponseBytes,
		maxErrorBytes: input.maxErrorBytes ?? DEFAULT_HTTP_LIMITS.maxErrorBytes,
		maxEventBytes: input.maxEventBytes ?? DEFAULT_HTTP_LIMITS.maxEventBytes,
	};
	if (
		Object.values(limits).some(
			(value) => !Number.isSafeInteger(value) || value <= 0,
		) ||
		limits.timeoutMs > 2_147_483_647
	)
		throw new RuntimeConnectionInvalid();
	return limits;
};
