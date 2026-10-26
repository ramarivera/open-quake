import { Effect, Layer } from "effect";
import { expect, it } from "vitest";
import { SystemMediaAdapter, SystemMediaService } from "../system-media";
import { mediaSession } from "../test-fixtures";
import { MediaProcessFailed } from "./errors";
import { launchMediaPlayer } from "./launchers";
import {
	controlMacSession,
	macSessions,
	macSessionsScript,
} from "./mac-sessions";
import { makeWindowsMedia } from "./windows";

it("MAIN-145 MGMT-271 enumerates, targets and retains a lost selection until Follow Current", async () => {
	const b = { ...mediaSession, id: "b", appId: "b", appName: "B" };
	let present = true;
	const controls: string[] = [],
		targets: (string | null | undefined)[] = [];
	const adapter = Layer.succeed(SystemMediaAdapter, {
		read: (target) =>
			Effect.sync(() => {
				targets.push(target);
				return {
					session: target === "b" ? (present ? b : null) : mediaSession,
					sessions: [mediaSession, ...(present ? [b] : [])],
					lyrics: { _tag: "unavailable" as const },
					error: null,
				};
			}),
		control: (action) =>
			Effect.sync(() => {
				controls.push(action);
				return true;
			}),
	});
	await Effect.runPromise(
		Effect.gen(function* () {
			const service = yield* SystemMediaService;
			expect((yield* service.read("b")).sessions).toHaveLength(2);
			yield* service.control("toggle");
			present = false;
			const lost = yield* service.control("next");
			expect(lost.accepted).toBe(false);
			expect(lost.media).toMatchObject({
				target: "b",
				session: null,
				error: "SESSION_LOST",
				lyrics: { _tag: "unavailable" },
			});
			expect((yield* service.read(null)).session?.id).toBe(mediaSession.id);
		}).pipe(
			Effect.provide(SystemMediaService.Default.pipe(Layer.provide(adapter))),
		),
	);
	expect(controls).toEqual(["pause"]);
	expect(targets).toContain("b");
});
it("MAIN-145 returns bounded native lyrics/artwork availability and passes session data outside source", async () => {
	const target = "com.apple.Music:12",
		session = { ...mediaSession, id: target };
	const run = (
		_file: string,
		args: readonly string[],
		env?: Readonly<Record<string, string>>,
	) => {
		expect(args).toContain(macSessionsScript);
		expect(env?.OPEN_QUAKE_MEDIA_TARGET).toBe(target);
		return Effect.succeed(
			JSON.stringify(
				env?.OPEN_QUAKE_MEDIA_REQUEST
					? { accepted: false }
					: {
							session,
							sessions: [session],
							source: "com.apple.Music",
							commands: [0, 1],
							lyrics: "actual native lyrics",
						},
			),
		);
	};
	expect(await Effect.runPromise(macSessions(run, target))).toMatchObject({
		lyrics: "actual native lyrics",
		session: { coverUrl: mediaSession.coverUrl },
	});
	expect(await Effect.runPromise(controlMacSession(run, target, "pause"))).toBe(
		false,
	);
	const windows = makeWindowsMedia((_file, _args, env) => {
		expect(env?.OPEN_QUAKE_MEDIA_TARGET).toBe("gone");
		return Effect.succeed(
			JSON.stringify({
				session: null,
				source: "",
				commands: [],
				sessions: [mediaSession],
			}),
		);
	});
	expect(await Effect.runPromise(windows.read("gone"))).toMatchObject({
		session: null,
		sessions: [
			{
				id: mediaSession.id,
				appId: mediaSession.appId,
				appName: mediaSession.appName,
				playing: mediaSession.playing,
			},
		],
	});
});
it("MAIN-145 launcher uses a closed catalog and reports native failures", async () => {
	const calls: unknown[] = [];
	expect(
		await Effect.runPromise(
			launchMediaPlayer(
				"darwin",
				(file, args) =>
					Effect.sync(() => {
						calls.push([file, args]);
						return "";
					}),
				"apple",
			),
		),
	).toBe(true);
	expect(calls).toEqual([["/usr/bin/open", ["-b", "com.apple.Music"]]]);
	expect(
		await Effect.runPromise(
			launchMediaPlayer(
				"win32",
				() =>
					Effect.fail(MediaProcessFailed.fromCause(new Error("not installed"))),
				"qq",
			),
		),
	).toBe(false);
	expect(
		await Effect.runPromise(
			launchMediaPlayer("linux", () => Effect.die("must not execute"), "apple"),
		),
	).toBe(false);
});

it("MAIN-073 native Windows volume uses fixed source and validates actual readback", async () => {
	const { nativeHostVolume, windowsVolumeScript } = await import("./volume");
	const calls: unknown[] = [];
	const port = nativeHostVolume("win32", false, (_file, args, env) => {
		expect(Buffer.from(args[4] ?? "", "base64").toString("utf16le")).toBe(
			windowsVolumeScript,
		);
		calls.push(env);
		return Effect.succeed('{"level":0,"muted":true}');
	});
	expect(await Effect.runPromise(port.read)).toEqual({ level: 0, muted: true });
	await Effect.runPromise(port.write({ level: 10, muted: false }));
	expect(calls[1]).toEqual({
		OPEN_QUAKE_VOLUME_REQUEST: '{"level":10,"muted":false}',
	});
	expect(
		(
			await Effect.runPromise(
				Effect.either(
					nativeHostVolume("win32", true, () => Effect.die("mock must not run"))
						.read,
				),
			)
		)._tag,
	).toBe("Left");
});
