import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { HostActionFailed } from "../../../../../../packages/device/src/actions/action-errors";
import { createDesktopDiagnostics } from "../../diagnostics";
import { makeDesktopRuntime } from "../../diagnostics/runtime";
import { systemMediaKeyActions } from "../key-actions";
import { SystemMediaAdapter, SystemMediaService } from "../system-media";
import { boundedCoverBytes } from "./cover";
import { MediaProcessFailed } from "./errors";
import { nativeSystemMedia } from "./index";
import { parseMacMedia } from "./metadata";
import type { MediaProcess } from "./process";
import { makeWindowsMedia, windowsMediaScript } from "./windows";

const payload = {
	bundleIdentifier: "net.example.player",
	processIdentifier: 23,
	title: "PRIVATE_TITLE",
	artist: "PRIVATE_ARTIST",
	playing: true,
	duration: 120,
	elapsedTimeNow: 200,
	supportedCommands: [0, 1, 4, 5, 3, 6, 7, 12, 13],
};
const cover = () => null;
async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), "system-media-"));
	await mkdir(join(directory, "MediaRemoteAdapter.framework"));
	await writeFile(
		join(directory, "MediaRemoteAdapter.framework/MediaRemoteAdapter"),
		"fixture",
	);
	await writeFile(join(directory, "mediaremote-adapter.pl"), "fixture");
	return directory;
}

describe("native system-media consumers", () => {
	it("rejects malformed and excessive artwork dimensions before native decode", () => {
		const png = Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlYAAAAAASUVORK5CYII=",
			"base64",
		);
		expect(boundedCoverBytes(png.toString("base64"), "image/png")).toEqual(png);
		png.writeUInt32BE(100000, 16);
		png.writeUInt32BE(100000, 20);
		expect(boundedCoverBytes(png.toString("base64"), "image/png")).toBeNull();
		expect(boundedCoverBytes("PHN2Zz4=", "image/svg+xml")).toBeNull();
		expect(
			boundedCoverBytes(
				Buffer.from([255, 216, 255, 255, 255, 255]).toString("base64"),
				"image/jpeg",
			),
		).toBeNull();
		for (let size = 0; size < 64; size++) {
			const bytes = Buffer.alloc(size, 255);
			if (size > 1) bytes[1] = 216;
			expect(() =>
				boundedCoverBytes(bytes.toString("base64"), "image/jpeg"),
			).not.toThrow();
		}
	});
	it.each([
		["SMTC_UNAVAILABLE", "QUAKE.MEDIA.HELPER_UNAVAILABLE"],
		["TCC_DENIED", "QUAKE.MEDIA.PROCESS_FAILED"],
	])(
		"classifies Windows %s without hiding its catalog cause",
		async (error, code) => {
			const result = await Effect.runPromise(
				Effect.either(
					makeWindowsMedia(() =>
						Effect.succeed(JSON.stringify({ error })),
					).read(),
				),
			);
			expect(Either.isLeft(result) && result.left.code).toBe(code);
		},
	);

	it("decodes bounded source metadata, clamps position and takes capabilities only from enabled native commands", async () => {
		const value = await Effect.runPromise(
			parseMacMedia(
				JSON.stringify({ ...payload, supportedCommands: [1] }),
				cover,
			),
		);
		expect(value?.session).toMatchObject({
			id: "net.example.player:23",
			positionMs: 120000,
			durationMs: 120000,
			canPlay: false,
			canPause: true,
			canNext: false,
			canPrevious: false,
			coverUrl: null,
		});
		expect(await Effect.runPromise(parseMacMedia("null", cover))).toBeNull();
		const malformed = await Effect.runPromise(
			Effect.either(parseMacMedia('{"duration":1e999}', cover)),
		);
		expect(Either.isLeft(malformed)).toBe(true);
		const unbundled = await Effect.runPromise(
			parseMacMedia(
				JSON.stringify({ ...payload, bundleIdentifier: undefined }),
				cover,
			),
		);
		expect(unbundled?.session).toMatchObject({
			id: "pid:23",
			appId: "",
			appName: "",
		});
		for (const value of [
			{ ...payload, supportedCommands: undefined },
			{ ...payload, processIdentifier: 0 },
			{ ...payload, processIdentifier: 1.5 },
			{ ...payload, title: "x".repeat(1001) },
			{ ...payload, playing: "yes" },
		]) {
			const result = await Effect.runPromise(
				Effect.either(parseMacMedia(JSON.stringify(value), cover)),
			);
			expect(Either.isLeft(result) && result.left.code).toBe(
				"QUAKE.MEDIA.RESPONSE_INVALID",
			);
		}
	});
	it("keeps transport metadata and controls when optional artwork is excessive", async () => {
		let decodeCalls = 0;
		const value = await Effect.runPromise(
			parseMacMedia(
				JSON.stringify({
					...payload,
					artworkData: "a".repeat(2_800_001),
					artworkMimeType: "image/png",
				}),
				() => {
					decodeCalls++;
					return null;
				},
			),
		);
		expect(value?.session).toMatchObject({
			title: payload.title,
			playing: true,
			canPlay: true,
			coverUrl: null,
		});
		expect(decodeCalls).toBe(0);
	});

	it("serializes real native-adapter controls through the shared service and pins the source without shell interpolation", async () => {
		const directory = await fixture();
		const calls: {
			args: readonly string[];
			values: Readonly<Record<string, string>> | undefined;
		}[] = [];
		let playing = true;
		const run: MediaProcess = (_file, args, values) =>
			Effect.sync(() => {
				calls.push({ args, values });
				if (args[2] === "send") {
					playing = args[3] === "0";
					return "";
				}
				return JSON.stringify({ ...payload, playing });
			});
		try {
			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const service = yield* SystemMediaService;
					return yield* Effect.all(
						[service.control("toggle"), service.control("toggle")],
						{ concurrency: "unbounded" },
					);
				}).pipe(
					Effect.provide(
						SystemMediaService.Default.pipe(
							Layer.provide(
								nativeSystemMedia({
									directory,
									platform: "darwin",
									enabled: true,
									cover,
									run,
								}),
							),
						),
					),
				),
			);
			expect(result.map((v) => v.accepted)).toEqual([true, true]);
			expect(result.map((v) => v.media.session?.playing)).toEqual([
				false,
				true,
			]);
			expect(
				calls
					.filter((v) => v.args[2] === "send")
					.map((v) => [v.args[3], v.values?.OPEN_QUAKE_MEDIA_EXPECTED_APP]),
			).toEqual([
				["1", payload.bundleIdentifier],
				["0", payload.bundleIdentifier],
			]);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	it("mock and unsupported platforms perform zero process IO, and missing helper stays unavailable", async () => {
		let calls = 0;
		const run: MediaProcess = () =>
			Effect.sync(() => {
				calls++;
				return "null";
			});
		for (const [platform, enabled, error] of [
			["darwin", false, "MEDIAREMOTE_UNAVAILABLE"],
			["win32", false, "SMTC_UNAVAILABLE"],
			["linux", true, "UNSUPPORTED_PLATFORM"],
			["darwin", true, "MEDIAREMOTE_UNAVAILABLE"],
		] as const) {
			const result = await Effect.runPromise(
				SystemMediaService.control("toggle").pipe(
					Effect.provide(
						SystemMediaService.Default.pipe(
							Layer.provide(
								nativeSystemMedia({
									directory: "/nonexistent/helper",
									platform,
									enabled,
									cover,
									run,
								}),
							),
						),
					),
				),
			);
			expect(result.accepted).toBe(false);
			expect(result.media.error).toBe(error);
		}
		expect(calls).toBe(0);
	});
	it("retains real native failure identity inside a correlated private diagnostic trace", async () => {
		const directory = await fixture();
		const nativeCause = Object.assign(
			new Error("PRIVATE_NATIVE_TEXT /Users/private/path"),
			{ code: "EACCES" },
		);
		const failure = MediaProcessFailed.fromCause(nativeCause);
		expect(failure.originalCause).toBe(nativeCause);
		expect(JSON.stringify(failure)).not.toContain("PRIVATE_NATIVE_TEXT");
		const diagnostics = createDesktopDiagnostics({
			directory: join(directory, "diagnostics"),
		});
		const runtime = makeDesktopRuntime(
			SystemMediaService.Default.pipe(
				Layer.provide(
					nativeSystemMedia({
						directory,
						platform: "darwin",
						enabled: true,
						cover,
						run: () => Effect.fail(failure),
					}),
				),
			),
			diagnostics,
		);
		try {
			const result = await runtime.runPromise(
				SystemMediaService.control("toggle"),
			);
			expect(result.media.error).toBe("TCC_DENIED");
			await runtime.dispose();
			await diagnostics.close();
			const files = await readdir(join(directory, "diagnostics"));
			const records = (
				await Promise.all(
					files
						.filter((file) => file.endsWith(".ndjson"))
						.map((file) =>
							readFile(join(directory, "diagnostics", file), "utf8"),
						),
				)
			).join("");
			expect(records).toContain("QUAKE.MEDIA.PROCESS_FAILED");
			expect(records).toContain("EACCES");
			expect(records).toContain("SystemMedia.macRead");
			expect(records).not.toMatch(
				/PRIVATE_NATIVE_TEXT|PRIVATE_TITLE|PRIVATE_ARTIST|private\/path/,
			);
		} finally {
			await runtime.dispose();
			await diagnostics.close();
			await rm(directory, { recursive: true, force: true });
		}
	});
	it("source replacement and unsupported commands reject instead of emitting another native command", async () => {
		const directory = await fixture();
		let sends = 0;
		try {
			const layer = nativeSystemMedia({
				directory,
				platform: "darwin",
				enabled: true,
				cover,
				run: (file, args) => {
					if (file === "/usr/bin/osascript")
						return Effect.succeed(
							'{"sessions":[],"session":null,"source":"","commands":[]}',
						);
					if (args[2] === "get")
						return Effect.succeed(
							JSON.stringify({ ...payload, supportedCommands: [0] }),
						);
					sends++;
					return Effect.fail(
						MediaProcessFailed.fromCause(
							Object.assign(new Error("replaced"), { code: 76 }),
						),
					);
				},
			});
			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const adapter = yield* SystemMediaAdapter;
					yield* adapter.read();
					const unsupported = yield* adapter.control("next");
					const replaced = yield* adapter.control("play");
					return [unsupported, replaced];
				}).pipe(Effect.provide(layer)),
			);
			expect(result).toEqual([false, false]);
			expect(sends).toBe(1);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	it("action-key adapter uses shared service and retains cancellation and native error causes", async () => {
		const calls: string[] = [];
		const adapter = systemMediaKeyActions(async (command, signal) => {
			expect(signal.aborted).toBe(false);
			calls.push(command);
			return { accepted: command === "audio_next" };
		});
		await Effect.runPromise(adapter.sendMedia("audio_next"));
		const refused = await Effect.runPromise(
			Effect.either(adapter.sendMedia("audio_stop")),
		);
		expect(Either.isLeft(refused) && refused.left._tag).toBe(
			"HostActionFailed",
		);
		expect(calls).toEqual(["audio_next", "audio_stop"]);
		const cause = MediaProcessFailed.fromCause(new Error("private"));
		const broken = systemMediaKeyActions(async () => {
			throw cause;
		});
		const result = await Effect.runPromise(
			Effect.either(broken.sendMedia("audio_play")),
		);
		expect(
			Either.isLeft(result) &&
				result.left instanceof HostActionFailed &&
				result.left.originalCause,
		).toBe(cause);
	});
	it("Windows uses a fixed encoded script and source data only in the environment", async () => {
		let env: Readonly<Record<string, string>> | undefined;
		const run: MediaProcess = (_file, args, values) => {
			expect(args.slice(0, 4)).toEqual([
				"-NoLogo",
				"-NoProfile",
				"-NonInteractive",
				"-EncodedCommand",
			]);
			expect(Buffer.from(args[4] ?? "", "base64").toString("utf16le")).toBe(
				windowsMediaScript,
			);
			env = values;
			return Effect.succeed(
				values?.OPEN_QUAKE_MEDIA_REQUEST
					? '{"accepted":false}'
					: '{"session":null,"commands":[],"source":""}',
			);
		};
		const adapter = makeWindowsMedia(run);
		expect(await Effect.runPromise(adapter.read())).toMatchObject({
			session: null,
			sessions: [],
		});
		const reading = await Effect.runPromise(
			parseMacMedia(JSON.stringify(payload), cover),
		);
		if (!reading) throw new Error("fixture absent");
		expect(
			await Effect.runPromise(
				adapter.control("pause", { ...reading, source: "a';$(private)" }),
			),
		).toBe(false);
		expect(JSON.parse(env?.OPEN_QUAKE_MEDIA_REQUEST ?? "")).toEqual({
			action: "pause",
			source: "a';$(private)",
		});
	});
});
