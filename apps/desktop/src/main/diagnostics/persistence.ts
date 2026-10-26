import {
	chmod,
	type FileHandle,
	lstat,
	mkdir,
	open,
	rename,
	unlink,
} from "node:fs/promises";
import { join } from "node:path";
import { type SafeError, safeError } from "./privacy.js";

export interface DiagnosticStorageOptions {
	readonly directory: string;
	readonly maxFileBytes?: number;
	readonly maxFiles?: number;
	readonly maxQueueBytes?: number;
	readonly now?: () => Date;
}
export interface DiagnosticStatus {
	readonly written: number;
	readonly dropped: number;
	readonly storageFailures: number;
	readonly queuedBytes: number;
	readonly closed: boolean;
	readonly lastFailure?: {
		readonly code: "DIAGNOSTICS.STORAGE_FAILED";
		readonly cause: SafeError;
	};
}

const bounded = (
	value: number | undefined,
	fallback: number,
	min: number,
	max: number,
) =>
	value !== undefined && Number.isFinite(value)
		? Math.max(min, Math.min(max, Math.floor(value)))
		: fallback;
const isMissing = (cause: unknown): boolean =>
	cause instanceof Error && "code" in cause && cause.code === "ENOENT";

/** Single serialized writer, bounded before IO. Diagnostics failure never rejects application work. */
export function createDiagnosticStorage(options: DiagnosticStorageOptions) {
	const maxFileBytes = bounded(
		options.maxFileBytes,
		10 * 1024 * 1024,
		1024,
		16 * 1024 * 1024,
	);
	const maxFiles = bounded(options.maxFiles, 30, 1, 30);
	const maxQueueBytes = bounded(
		options.maxQueueBytes,
		512 * 1024,
		1024,
		2 * 1024 * 1024,
	);
	const path = (index: number) =>
		join(options.directory, `diagnostics.${index}.ndjson`);
	let handle: FileHandle | undefined;
	let bytes = 0;
	const day = (date: Date) =>
		`${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
	const now = options.now ?? (() => new Date());
	let currentDay: string | undefined;
	let queue: { line: string; day: string }[] = [];
	let queuedBytes = 0;
	let written = 0;
	let dropped = 0;
	let storageFailures = 0;
	let closed = false;
	let pumping: Promise<void> | undefined;
	let closing: Promise<DiagnosticStatus> | undefined;
	let lastFailure: DiagnosticStatus["lastFailure"];
	const status = (): DiagnosticStatus => ({
		written,
		dropped,
		storageFailures,
		queuedBytes,
		closed,
		...(lastFailure ? { lastFailure } : {}),
	});
	const failed = (cause: unknown) => {
		storageFailures++;
		lastFailure = {
			code: "DIAGNOSTICS.STORAGE_FAILED",
			cause: safeError(cause),
		};
	};
	const closeHandle = async () => {
		const current = handle;
		handle = undefined;
		if (current) await current.close();
	};
	const acquire = async () => {
		if (handle) return;
		await mkdir(options.directory, { recursive: true, mode: 0o700 });
		const directory = await lstat(options.directory);
		if (!directory.isDirectory() || directory.isSymbolicLink())
			throw new Error("Unsafe diagnostic directory");
		await chmod(options.directory, 0o700);
		// Reject links and non-files before opening/rotating retained files.
		for (let index = 0; index < maxFiles; index++) {
			try {
				const stat = await lstat(path(index));
				if (!stat.isFile() || stat.isSymbolicLink())
					throw new Error("Unsafe diagnostic file");
				if (stat.size > maxFileBytes) await unlink(path(index));
				else await chmod(path(index), 0o600);
			} catch (cause) {
				if (!isMissing(cause)) throw cause;
			}
		}
		for (let index = maxFiles; index < 30; index++) {
			try {
				await unlink(path(index));
			} catch (cause) {
				if (!isMissing(cause)) throw cause;
			}
		}
		handle = await open(path(0), "a", 0o600);
		const active = await handle.stat();
		bytes = active.size;
		currentDay = day(bytes ? active.mtime : now());
	};
	const rotate = async () => {
		await handle?.sync();
		await closeHandle();
		try {
			await unlink(path(maxFiles - 1));
		} catch (cause) {
			if (!isMissing(cause)) throw cause;
		}
		for (let index = maxFiles - 2; index >= 0; index--) {
			try {
				await rename(path(index), path(index + 1));
			} catch (cause) {
				if (!isMissing(cause)) throw cause;
			}
		}
		await acquire();
	};
	const pump = async () => {
		try {
			while (queue.length > 0) {
				await acquire();
				const record = queue[0];
				if (record === undefined) break;
				const { line } = record;
				const size = Buffer.byteLength(line);
				if (
					bytes + size > maxFileBytes ||
					(bytes > 0 && currentDay !== record.day)
				)
					await rotate();
				currentDay = record.day;
				await handle?.writeFile(line, "utf8");
				bytes += size;
				queue.shift();
				queuedBytes -= size;
				written++;
			}
		} catch (cause) {
			failed(cause);
			dropped += queue.length;
			queue = [];
			queuedBytes = 0;
			try {
				await closeHandle();
			} catch (closeCause) {
				failed(closeCause);
			}
		} finally {
			pumping = undefined;
		}
	};
	const emit = (record: object): void => {
		try {
			if (closed) {
				dropped++;
				return;
			}
			const line = `${JSON.stringify(record)}\n`;
			const size = Buffer.byteLength(line);
			if (size > maxFileBytes || queuedBytes + size > maxQueueBytes) {
				dropped++;
				return;
			}
			queue.push({ line, day: day(now()) });
			queuedBytes += size;
			if (!pumping) pumping = pump();
		} catch (cause) {
			dropped++;
			failed(cause);
		}
	};
	const flush = async (): Promise<DiagnosticStatus> => {
		try {
			while (pumping) await pumping;
			await handle?.sync();
		} catch (cause) {
			failed(cause);
		}
		return status();
	};
	const close = (): Promise<DiagnosticStatus> => {
		if (closing) return closing;
		closed = true;
		closing = (async () => {
			await flush();
			try {
				await closeHandle();
			} catch (cause) {
				failed(cause);
			}
			return status();
		})();
		return closing;
	};
	return { emit, flush, close, status };
}
