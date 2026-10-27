import type { Writable } from "node:stream";
import pino from "pino";
import { type SafeError, safeError } from "./privacy.js";

// Shared streams outlive an individual diagnostics owner. Keep one inert guard
// after close without retaining that owner's queues, counters or error objects.
const guardedStreams = new WeakSet<Writable>();
const ignoreLateError = () => undefined;

export interface DiagnosticOutputOptions {
	/** Process-owned stdout, never closed by diagnostics. false disables this copy. */
	readonly stdout?: Writable | false;
	readonly stdoutMaxBytes?: number;
	readonly stdoutDrainMs?: number;
}

export interface DiagnosticOutputStatus {
	readonly pinoFailures: number;
	readonly stdoutFailures: number;
	readonly stdoutDropped: number;
	readonly stdoutPendingBytes: number;
	readonly stdoutTimedOut: boolean;
	readonly lastOutputFailure?: SafeError;
}

/** Pino serializes projected records once. No worker, second file queue or raw Effect input. */
export function createPinoOutput(
	write: (line: string) => void,
	options: DiagnosticOutputOptions,
) {
	const stdout =
		options.stdout === false ? undefined : (options.stdout ?? process.stdout);
	const bound = (
		value: number | undefined,
		fallback: number,
		min: number,
		max: number,
	) =>
		value !== undefined && Number.isFinite(value)
			? Math.max(min, Math.min(max, Math.floor(value)))
			: fallback;
	const maxBytes = bound(
		options.stdoutMaxBytes,
		512 * 1024,
		1024,
		2 * 1024 * 1024,
	);
	const drainMs = bound(options.stdoutDrainMs, 1000, 1, 5000);
	let pending = 0;
	let pinoFailures = 0;
	let stdoutFailures = 0;
	let stdoutDropped = 0;
	let stdoutTimedOut = false;
	let lastOutputFailure: SafeError | undefined;
	let closed = false;
	let closing: Promise<void> | undefined;
	const waiters = new Set<() => void>();
	const reportedErrors = new WeakSet<object>();
	const outputFailed = (cause: unknown) => {
		// Node reports the same write failure through its callback and error event.
		if (typeof cause === "object" && cause !== null) {
			if (reportedErrors.has(cause)) return;
			reportedErrors.add(cause);
		}
		stdoutFailures++;
		lastOutputFailure = safeError(cause);
	};
	// Writable errors may arrive after write's callback, including after the drain deadline.
	stdout?.on("error", outputFailed);
	const destination = {
		write(line: string) {
			write(line);
			if (!stdout || closed) return;
			const size = Buffer.byteLength(line);
			if (
				stdoutFailures > 0 ||
				pending + size > maxBytes ||
				stdout.writableLength + size > maxBytes
			) {
				stdoutDropped++;
				return;
			}
			pending += size;
			let finished = false;
			const done = (cause?: Error | null) => {
				if (finished) return;
				finished = true;
				pending -= size;
				if (cause) outputFailed(cause);
				if (pending === 0) for (const wake of waiters) wake();
			};
			try {
				stdout.write(line, done);
			} catch (cause) {
				outputFailed(cause);
				done();
			}
		},
	};
	const logger = pino(
		{
			base: null,
			timestamp: false,
			level: "trace",
			// Keep schema 1's string level and ISO time, supplied by the safe projection.
			formatters: { level: (_label, value) => ({ pino_level: value }) },
		},
		destination,
	);
	const emit = (record: object) => {
		try {
			const level = "level" in record ? record.level : undefined;
			if (level === "FATAL") logger.fatal(record);
			else if (
				level === "ERROR" ||
				("outcome" in record && record.outcome === "failure")
			)
				logger.error(record);
			else if (level === "WARN" || level === "WARNING") logger.warn(record);
			else if (level === "DEBUG") logger.debug(record);
			else if (level === "TRACE") logger.trace(record);
			else logger.info(record);
		} catch (cause) {
			pinoFailures++;
			lastOutputFailure = safeError(cause);
			// The input is already projected. Preserve local evidence if serialization fails.
			try {
				write(`${JSON.stringify(record)}\n`);
			} catch {
				// Delivery must never replace the application failure.
			}
		}
	};
	const drain = (): Promise<void> => {
		if (!pending) return Promise.resolve();
		return new Promise((resolve) => {
			const finish = () => {
				clearTimeout(timer);
				waiters.delete(finish);
				resolve();
			};
			const timer = setTimeout(() => {
				stdoutTimedOut = true;
				finish();
			}, drainMs);
			waiters.add(finish);
		});
	};
	const close = () => {
		if (closing) return closing;
		closed = true;
		closing = drain().finally(() => {
			if (stdout) {
				if (!guardedStreams.has(stdout)) {
					stdout.on("error", ignoreLateError);
					guardedStreams.add(stdout);
				}
				stdout.removeListener("error", outputFailed);
			}
		});
		return closing;
	};
	const status = (): DiagnosticOutputStatus => ({
		pinoFailures,
		stdoutFailures,
		stdoutDropped,
		stdoutPendingBytes: pending,
		stdoutTimedOut,
		...(lastOutputFailure ? { lastOutputFailure } : {}),
	});
	return { emit, drain, close, status };
}
