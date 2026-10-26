import { Effect, Ref } from "effect";
import type { SoundSession } from "./playback-contracts.js";

/** Allowlist fields and detach nested values at both repository boundaries. */
export const copySoundSession = (session: SoundSession): SoundSession => ({
	playbackId: session.playbackId,
	generation: session.generation,
	owner: { profileId: session.owner.profileId, keyCode: session.owner.keyCode },
	playlistRevision: session.playlistRevision,
	trackIndex: session.trackIndex,
	state: session.state,
	loopTrack: session.loopTrack,
	positionMs: session.positionMs,
	gain: session.gain,
	entries: session.entries.map(({ fileId, status }) => ({ fileId, status })),
	...(session.errorCode === undefined ? {} : { errorCode: session.errorCode }),
});

/** Runtime observations only. The profile owner remains the sole durable configuration owner. */
export class SoundboardRepository extends Effect.Service<SoundboardRepository>()(
	"@open-quake/edge/SoundboardRepository",
	{
		accessors: true,
		effect: Effect.gen(function* () {
			const records = yield* Ref.make<readonly SoundSession[]>([]);
			return {
				list: Effect.fn("SoundboardRepository.list")(
					(): Effect.Effect<readonly SoundSession[]> =>
						Ref.get(records).pipe(
							Effect.map((items) => items.map(copySoundSession)),
						),
				),
				put: Effect.fn("SoundboardRepository.put")(
					(session: SoundSession): Effect.Effect<void> =>
						Ref.update(records, (current) => {
							// Replacing an observation must not change playback selection order.
							const replacement = copySoundSession(session);
							const next = current.some(
								(record) => record.playbackId === session.playbackId,
							)
								? current.map((record) =>
										record.playbackId === session.playbackId
											? replacement
											: record,
									)
								: [...current, replacement];
							const active = next.filter(
								(record) =>
									record.state !== "stopped" && record.state !== "failed",
							);
							const terminal = next
								.filter(
									(record) =>
										record.state === "stopped" || record.state === "failed",
								)
								.slice(-256);
							return [...terminal, ...active];
						}),
				),
			};
		}),
	},
) {}
