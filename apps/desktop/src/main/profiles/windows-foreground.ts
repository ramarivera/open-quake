import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import type { EventEmitter } from "node:events";
import { Option, Schema } from "effect";
import type { ForegroundApp } from "../../../../../packages/device/src/profiles/profile-switching-invariants.js";
import { windowsForegroundScript } from "./windows-foreground-script";

export type WindowsForegroundProcess = Pick<
	ChildProcessWithoutNullStreams,
	"stdin" | "stdout" | "stderr" | "kill"
> &
	Pick<EventEmitter, "on" | "removeListener">;
export type SpawnWindowsForeground = () => WindowsForegroundProcess;
const deadlineMs = 5000;
const maxOutputBytes = 64 * 1024;
const replySchema = Schema.Union(
	Schema.Struct({
		requestId: Schema.String,
		status: Schema.Literal("foreground"),
		id: Schema.NonEmptyString,
		path: Schema.NonEmptyString,
	}),
	Schema.Struct({
		requestId: Schema.String,
		status: Schema.Literal("none", "error"),
	}),
);
const startProcess: SpawnWindowsForeground = () =>
	spawn(
		"powershell.exe",
		[
			"-NoLogo",
			"-NoProfile",
			"-NonInteractive",
			"-EncodedCommand",
			Buffer.from(windowsForegroundScript, "utf16le").toString("base64"),
		],
		{ windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
	);

interface Request {
	readonly id: string;
	readonly promise: Promise<Option.Option<ForegroundApp>>;
	readonly resolve: (app: Option.Option<ForegroundApp>) => void;
	readonly reject: (cause: unknown) => void;
	readonly timer: ReturnType<typeof setTimeout>;
}
export interface WindowsForegroundHelper {
	readonly probe: () => Promise<Option.Option<ForegroundApp>>;
	readonly dispose: () => Promise<void>;
}

interface Session {
	readonly child: WindowsForegroundProcess;
	readonly closed: Promise<void>;
	readonly resolveClosed: () => void;
	exited: boolean;
	stopCause?: unknown;
	broken: boolean;
	buffer: Buffer;
	outputBytes: number;
}

/** One child and one request at a time. A failed child must close before replacement. */
export const makeWindowsForeground = (
	spawnChild: SpawnWindowsForeground = startProcess,
): WindowsForegroundHelper => {
	let session: Session | undefined;
	let pending: Request | undefined;
	let sequence = 0;
	let disposed = false;
	let disposal: Promise<void> | undefined;
	const settle = (cause: unknown): void => {
		const request = pending;
		pending = undefined;
		if (request) {
			clearTimeout(request.timer);
			request.reject(cause);
		}
	};
	const retire = (current: Session, cause: unknown): void => {
		if (session !== current || current.broken) return;
		current.broken = true;
		current.buffer = Buffer.alloc(0);
		settle(cause);
		try {
			current.child.stdin.end();
		} catch (cause) {
			current.stopCause = cause;
		}
		if (!current.exited) {
			try {
				current.child.kill();
			} catch (cause) {
				current.stopCause = cause;
			}
		}
	};
	const start = (): Session => {
		const child = spawnChild();
		let resolveClosed!: () => void;
		const closed = new Promise<void>((resolve) => {
			resolveClosed = resolve;
		});
		const current: Session = {
			child,
			closed,
			resolveClosed,
			exited: false,
			broken: false,
			buffer: Buffer.alloc(0),
			outputBytes: 0,
		};
		session = current;
		const fail = (cause: unknown): void => retire(current, cause);
		const onExit = (): void => {
			current.exited = true;
			fail(new Error("Foreground helper exited"));
		};
		const onClose = (): void => {
			onExit();
			if (session === current) session = undefined;
			child.stdout.removeListener("data", onData);
			child.stderr.removeListener("data", onStderr);
			child.stdout.removeListener("error", fail);
			child.stderr.removeListener("error", fail);
			child.stdin.removeListener("error", fail);
			child.removeListener("error", fail);
			child.removeListener("exit", onExit);
			child.removeListener("close", onClose);
			current.resolveClosed();
		};
		const count = (chunk: Buffer): boolean => {
			current.outputBytes += chunk.length;
			if (current.outputBytes <= maxOutputBytes) return true;
			fail(new Error("Foreground helper output limit exceeded"));
			return false;
		};
		const onStderr = (chunk: Buffer): void => {
			if (!current.broken) count(chunk);
		};
		const onData = (chunk: Buffer): void => {
			if (current.broken || !count(chunk)) return;
			current.buffer = Buffer.concat([current.buffer, chunk]);
			let newline = current.buffer.indexOf(10);
			while (newline !== -1) {
				const line = current.buffer.subarray(0, newline).toString("utf8");
				current.buffer = current.buffer.subarray(newline + 1);
				try {
					const reply = Schema.decodeUnknownSync(replySchema)(JSON.parse(line));
					const request = pending;
					if (!request || reply.requestId !== request.id)
						throw new Error("Foreground helper request mismatch");
					pending = undefined;
					clearTimeout(request.timer);
					if (reply.status === "error")
						request.reject(new Error("Foreground helper lookup failed"));
					else
						request.resolve(
							reply.status === "foreground"
								? Option.some({ id: reply.id, path: reply.path })
								: Option.none(),
						);
				} catch (cause) {
					fail(cause);
					return;
				}
				newline = current.buffer.indexOf(10);
			}
			if (current.buffer.length && !pending)
				fail(new Error("Unexpected foreground helper output"));
		};
		child.on("error", fail);
		child.on("exit", onExit);
		child.on("close", onClose);
		child.stdin.on("error", fail);
		child.stdout.on("error", fail);
		child.stderr.on("error", fail);
		child.stdout.on("data", onData);
		child.stderr.on("data", onStderr);
		return current;
	};
	return {
		probe: (): Promise<Option.Option<ForegroundApp>> => {
			if (disposed)
				return Promise.reject(new Error("Foreground helper disposed"));
			if (pending) return pending.promise;
			if (session?.broken)
				return Promise.reject(new Error("Foreground helper is stopping"));
			let current: Session;
			try {
				current = session ?? start();
			} catch (cause) {
				return Promise.reject(cause);
			}
			current.outputBytes = current.buffer.length;
			const id = String(++sequence);
			let resolveRequest!: Request["resolve"];
			let rejectRequest!: Request["reject"];
			const promise = new Promise<Option.Option<ForegroundApp>>(
				(resolve, reject) => {
					resolveRequest = resolve;
					rejectRequest = reject;
				},
			);
			pending = {
				id,
				promise,
				resolve: resolveRequest,
				reject: rejectRequest,
				timer: setTimeout(
					() =>
						retire(current, new Error("Foreground helper deadline exceeded")),
					deadlineMs,
				),
			};
			try {
				current.child.stdin.write(`${id}\n`, (cause) => {
					if (cause) retire(current, cause);
				});
			} catch (cause) {
				retire(current, cause);
			}
			return promise;
		},
		dispose: (): Promise<void> => {
			if (disposal) return disposal;
			disposed = true;
			const current = session;
			if (!current) {
				disposal = Promise.resolve();
				return disposal;
			}
			// Wait for actual close, bounded independently of a pending request.
			disposal = new Promise<void>((resolve, reject) => {
				const timer = setTimeout(
					() =>
						reject(
							current.stopCause ??
								new Error("Foreground helper shutdown deadline exceeded"),
						),
					deadlineMs,
				);
				void current.closed.then(() => {
					clearTimeout(timer);
					resolve();
				});
			});
			retire(current, new Error("Foreground helper disposed"));
			return disposal;
		},
	};
};
