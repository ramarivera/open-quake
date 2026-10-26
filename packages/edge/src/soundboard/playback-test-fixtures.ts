import { Deferred, Effect } from "effect";
import { AudioOutput, makeAudioOutput } from "../audio/output-service.js";
import type { SoundOwner, SoundPlaylist } from "./playback-contracts.js";
import { SoundboardPlayer, type SoundPlayer } from "./playback-ports.js";
import type { SoundboardDecodeFailed } from "./soundboard-errors.js";
import { SoundboardFiles } from "./soundboard-ports.js";
import { SoundboardRepository } from "./soundboard-repository.js";
import { makeSoundboardService } from "./soundboard-service.js";
export const owner: SoundOwner = { profileId: "profile-a", keyCode: "1" };
export const playlist: SoundPlaylist = {
	revision: 1,
	entries: ["a", "b", "c"].map((name) => ({
		fileId: name,
		path: `/private/music/${name}.mp3`,
		status: "available",
	})),
	volume: 50,
	fade: { mode: "none", durationMs: 0 },
};
export interface Track {
	readonly fileId: string;
	readonly end: Deferred.Deferred<void, SoundboardDecodeFailed>;
	closed: number;
	plays: number;
	gains: number[];
	pauses: number;
	positionMs: number;
}
export const rig = (
	ready: SoundPlayer["ready"] = Effect.void,
	teardown: Effect.Effect<void> = Effect.void,
	metadata: Effect.Effect<void> = Effect.void,
	released: Effect.Effect<void> = Effect.void,
	command: (
		method: "gain" | "play" | "pause" | "position",
	) => Effect.Effect<void, SoundboardDecodeFailed> = () => Effect.void,
) =>
	Effect.gen(function* () {
		const output = yield* makeAudioOutput;
		const repository = yield* SoundboardRepository.pipe(
			Effect.provide(SoundboardRepository.Default),
		);
		const tracks: Track[] = [];
		const inspected: string[] = [];
		const unavailable = new Set<string>();
		const service = yield* makeSoundboardService.pipe(
			Effect.provideService(
				AudioOutput,
				AudioOutput.make({
					...output,
					acquire: (kind, preempt) =>
						output.acquire(kind, preempt).pipe(
							Effect.map((lease) => ({
								...lease,
								release: released.pipe(Effect.zipRight(lease.release)),
							})),
						),
				}),
			),
			Effect.provideService(SoundboardRepository, repository),
			Effect.provideService(SoundboardFiles, {
				inspect: (path) =>
					metadata.pipe(
						Effect.zipRight(
							Effect.sync(() => {
								inspected.push(path);
								return unavailable.has(path)
									? ("missing" as const)
									: ("available" as const);
							}),
						),
					),
			}),
			Effect.provideService(SoundboardPlayer, {
				open: (entry) =>
					Effect.gen(function* () {
						const end = yield* Deferred.make<void, SoundboardDecodeFailed>();
						const track: Track = {
							fileId: entry.fileId,
							end,
							closed: 0,
							plays: 0,
							gains: [],
							pauses: 0,
							positionMs: 123,
						};
						tracks.push(track);
						yield* Effect.addFinalizer(() =>
							teardown.pipe(
								Effect.zipRight(
									Effect.sync(() => {
										track.closed++;
									}),
								),
							),
						);
						return {
							ready,
							ended: Deferred.await(end),
							position: command("position").pipe(
								Effect.zipRight(Effect.sync(() => track.positionMs)),
							),
							pause: command("pause").pipe(
								Effect.zipRight(
									Effect.sync(() => {
										track.pauses++;
									}),
								),
							),
							play: command("play").pipe(
								Effect.zipRight(
									Effect.sync(() => {
										track.plays++;
									}),
								),
							),
							gain: (value) =>
								command("gain").pipe(
									Effect.zipRight(
										Effect.sync(() => {
											track.gains.push(value);
										}),
									),
								),
						};
					}),
			}),
		);
		return { service, output, repository, tracks, unavailable, inspected };
	});
