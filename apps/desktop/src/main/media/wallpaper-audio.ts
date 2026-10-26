import { Effect } from "effect";
import type { AudioOutputLease } from "../../../../../packages/edge/src/audio/output-service";

/** Uses the canonical output owner. Acquisition and cleanup finish before a successor unmutes. */
export function wallpaperAudioSession(
	acquire: (mute: () => Promise<void>) => Promise<AudioOutputLease | undefined>,
) {
	let current: { id: string; lease?: AudioOutputLease } | undefined;
	let closed = false;
	let pending = Promise.resolve();
	const enqueue = <A>(work: () => Promise<A>): Promise<A> => {
		const result = pending.then(work);
		pending = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	};
	const release = async (request: typeof current): Promise<void> => {
		if (request?.lease) await Effect.runPromise(request.lease.release);
	};
	const stop = (id?: string): Promise<void> => {
		if (!current || (id !== undefined && current.id !== id)) return pending;
		const previous = current;
		current = undefined;
		return enqueue(() => release(previous));
	};
	return {
		start: (
			id: string,
			mute: () => Promise<void>,
			unmute: () => void,
			stillEligible: () => boolean = () => true,
		): Promise<boolean> => {
			if (closed) return Promise.resolve(false);
			const previous = current;
			const request: { id: string; lease?: AudioOutputLease } = { id };
			current = request;
			return enqueue(async () => {
				await release(previous);
				if (closed || current !== request || !stillEligible()) return false;
				const lease = await acquire(mute);
				if (!lease) {
					if (current === request) current = undefined;
					return false;
				}
				request.lease = lease;
				if (
					closed ||
					current !== request ||
					!stillEligible() ||
					!(await Effect.runPromise(lease.current))
				) {
					await release(request);
					if (current === request) current = undefined;
					return false;
				}
				unmute();
				return true;
			});
		},
		stop,
		close: (): Promise<void> => {
			closed = true;
			return stop();
		},
	};
}
