import type { SparkConnect } from "../../../../../packages/edge/src/ai/adapters/xfy";
/** Each call owns its socket and queue. Global input, device and audio are untouched. */
export const connectSpark: SparkConnect = (url, signal) =>
	new Promise((resolve, reject) => {
		const socket = new WebSocket(url);
		const queue: string[] = [];
		let wake: (() => void) | undefined;
		let ended = false;
		let failed = false;
		const close = () => {
			ended = true;
			signal.removeEventListener("abort", close);
			socket.close();
			wake?.();
		};
		if (signal.aborted) {
			close();
			reject(new Error("cancelled"));
			return;
		}
		signal.addEventListener("abort", close, { once: true });
		socket.addEventListener("error", () => {
			failed = true;
			close();
			reject(new Error("socket unavailable"));
		});
		socket.addEventListener("close", () => {
			ended = true;
			wake?.();
		});
		socket.addEventListener("message", (event) => {
			if (ended) return;
			if (
				typeof event.data !== "string" ||
				event.data.length > 1048576 ||
				queue.length >= 64
			) {
				failed = true;
				close();
				return;
			}
			queue.push(event.data);
			wake?.();
		});
		socket.addEventListener("open", () => {
			if (signal.aborted) {
				close();
				reject(new Error("cancelled"));
				return;
			}
			resolve({
				close,
				send: async (frame) => {
					if (ended) throw new Error("closed");
					socket.send(frame);
				},
				frames: {
					async *[Symbol.asyncIterator]() {
						while (!ended || queue.length) {
							const frame = queue.shift();
							if (frame !== undefined) yield frame;
							else
								await new Promise<void>((resolve) => {
									wake = resolve;
								});
						}
						if (failed) throw new Error("socket failed");
					},
				},
			});
		});
	});
