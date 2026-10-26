import { access } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import type { NativeMediaAction } from "../system-media";
import { MediaHelperUnavailable } from "./errors";
import { controlMacSession, macSessions } from "./mac-sessions";
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
		read: Effect.fn("SystemMedia.macRead")(function* (target?: string | null) {
			yield* check;
			const reading = yield* run("/usr/bin/perl", [
				script,
				framework,
				"get",
				"--now",
			]).pipe(Effect.flatMap((text) => parseMacMedia(text, cover)));
			const listed = yield* macSessions(run).pipe(
				Effect.catchAll(() => Effect.succeed(null)),
			);
			const sessions = [...(listed?.sessions ?? [])].map((s) =>
				s.id === reading?.session.id
					? { ...s, playing: reading.session.playing }
					: s,
			);
			if (reading && !sessions.some((s) => s.id === reading.session.id))
				sessions.push(reading.session);
			if (
				target &&
				(target !== reading?.session.id ||
					/^(com\.apple\.Music|com\.spotify\.client):/.test(target))
			) {
				if (!sessions.some((s) => s.id === target))
					return {
						session: null,
						source: "",
						commands: new Set<number>(),
						sessions,
					};
				const selected = yield* macSessions(run, target);
				return { ...selected, sessions };
			}
			if (!reading)
				return {
					session: null,
					source: "",
					commands: new Set<number>(),
					sessions,
				};
			return { ...reading, sessions };
		}),
		control: Effect.fn("SystemMedia.macControl")(function* (
			action: NativeMediaAction,
			reading: NativeMediaReading,
		) {
			if (
				!reading.processId &&
				/^(com\.apple\.Music|com\.spotify\.client):[0-9]+$/.test(
					reading.session.id,
				)
			) {
				const command = commands[action];
				if (!reading.commands.has(command)) return false;
				return yield* controlMacSession(run, reading.session.id, action);
			}
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
