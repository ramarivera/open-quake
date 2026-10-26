import { Effect, Schema } from "effect";
import type { JsonStore } from "../../../../../packages/edge/src/channels/channel-contracts";
import { SoundboardConfigInvalid } from "../../../../../packages/edge/src/soundboard/soundboard-errors";

const Resume = Schema.Struct({
	fingerprint: Schema.String,
	index: Schema.Int.pipe(Schema.nonNegative()),
	positionMs: Schema.Finite.pipe(Schema.nonNegative()),
});
export type LocalResume = typeof Resume.Type;
const Records = Schema.Record({ key: Schema.String, value: Resume });
/** Separate runtime resume data. Committed profile configuration remains with ProfileService. */
export function localResumeRepository(store?: JsonStore) {
	let records: typeof Records.Type = {};
	let loaded = false;
	const lock = Effect.unsafeMakeSemaphore(1);
	const load = Effect.gen(function* () {
		if (loaded) return;
		if (store)
			records = yield* Effect.tryPromise({
				try: () => store.read(),
				catch: (cause) => new SoundboardConfigInvalid(cause),
			}).pipe(
				Effect.flatMap((raw) => Schema.decodeUnknown(Records)(raw ?? {})),
				Effect.mapError((cause) => new SoundboardConfigInvalid(cause)),
			);
		loaded = true;
	});
	return {
		read: (owner: string) =>
			lock.withPermits(1)(load.pipe(Effect.map(() => records[owner]))),
		save: (owner: string, value: LocalResume) =>
			lock.withPermits(1)(
				Effect.gen(function* () {
					yield* load;
					if (JSON.stringify(records[owner]) === JSON.stringify(value)) return;
					const next = Object.fromEntries(
						[
							...Object.entries(records).filter(([key]) => key !== owner),
							[owner, value],
						].slice(-1024),
					);
					if (store)
						yield* Effect.tryPromise({
							try: () => store.write(next),
							catch: (cause) => new SoundboardConfigInvalid(cause),
						});
					records = next;
				}),
			),
	};
}
