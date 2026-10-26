import { access } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import type { NativeMediaAction } from "../system-media";
import { MediaHelperUnavailable } from "./errors";
import {
	type CoverDecoder,
	type NativeMediaReading,
	parseMacMedia,
} from "./metadata";
import { type MediaProcess, mediaProcess } from "./process";

const commands: Readonly<Record<NativeMediaAction, number>> = {
	play: 0,
	pause: 1,
	previous: 5,
	next: 4,
	stop: 3,
	rewind: 12,
	forward: 13,
	repeat: 7,
	shuffle: 6,
};
export const makeMacMedia = (
	directory: string,
	cover: CoverDecoder,
	run: MediaProcess = mediaProcess,
) => {
	const script = join(directory, "mediaremote-adapter.pl");
	const framework = join(directory, "MediaRemoteAdapter.framework");
	const check = Effect.tryPromise({
		try: () =>
			Promise.all([
				access(script),
				access(join(framework, "MediaRemoteAdapter")),
			]),
		catch: MediaHelperUnavailable.fromCause,
	});
	return {
		read: Effect.fn("SystemMedia.macRead")(function* () {
			yield* check;
			return yield* run("/usr/bin/perl", [
				script,
				framework,
				"get",
				"--now",
			]).pipe(Effect.flatMap((text) => parseMacMedia(text, cover)));
		}),
		control: Effect.fn("SystemMedia.macControl")(function* (
			action: NativeMediaAction,
			reading: NativeMediaReading,
		) {
			yield* check;
			const command = commands[action];
			if (!reading.commands.has(command) || !reading.processId) return false;
			yield* run(
				"/usr/bin/perl",
				[script, framework, "send", String(command)],
				{
					OPEN_QUAKE_MEDIA_EXPECTED_APP: reading.source,
					OPEN_QUAKE_MEDIA_EXPECTED_PID: String(reading.processId),
				},
			);
			return true;
		}),
	};
};
