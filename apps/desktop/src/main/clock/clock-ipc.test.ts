import { Effect, Layer, ManagedRuntime, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { ClockReply } from "../../shared/clock-contracts";
import { ClockPersistenceFailed } from "../../shared/clock-errors";
import {
	canRequestClock,
	handleClockCommand,
	parseMediaUrl,
} from "./clock-ipc";
import { ClockFiles, ClockRoot, ClockStore } from "./clock-store";

const RENDERER = "file:///Applications/open-quake.app/out/renderer/index.html";

describe("clock bridge permissions", () => {
	it("lets the strip read and switch themes only", () => {
		const panel = `${RENDERER}?surface=panel`;
		expect(canRequestClock(panel, RENDERER, { _tag: "read" }, false)).toBe(
			true,
		);
		expect(canRequestClock(panel, RENDERER, { _tag: "setTheme" }, false)).toBe(
			true,
		);
		for (const tag of [
			"setMode",
			"setSeconds",
			"chooseMedia",
			"commitMedia",
			"restoreMedia",
		])
			expect(canRequestClock(panel, RENDERER, { _tag: tag }, false)).toBe(
				false,
			);
		expect(
			canRequestClock(panel, RENDERER, { _tag: "chooseMedia" }, true),
		).toBe(true);
	});

	it("rejects other documents and garbage", () => {
		expect(
			canRequestClock(
				"https://evil.example/index.html",
				RENDERER,
				{ _tag: "read" },
				true,
			),
		).toBe(false);
		expect(
			canRequestClock(
				"file:///tmp/index.html",
				RENDERER,
				{ _tag: "read" },
				true,
			),
		).toBe(false);
		expect(canRequestClock("not a url", RENDERER, { _tag: "read" }, true)).toBe(
			false,
		);
		expect(canRequestClock(RENDERER, RENDERER, null, false)).toBe(false);
	});
});

describe("media URLs carry ids, never paths (WIDGETS-034)", () => {
	it("parses theme and candidate URLs", () => {
		expect(parseMediaUrl("oq-clock-media://theme/aurora?r=4")).toEqual({
			theme: "aurora",
		});
		const token = "a".repeat(32);
		expect(parseMediaUrl(`oq-clock-media://candidate/${token}`)).toEqual({
			candidate: token,
		});
	});

	it("rejects traversal, extra segments and other hosts", () => {
		for (const url of [
			"oq-clock-media://theme/..%2F..%2Fetc%2Fpasswd",
			"oq-clock-media://theme/aurora/extra",
			"oq-clock-media://theme/",
			"oq-clock-media://bg/media.png?p=%2Fetc%2Fpasswd",
			"oq-clock-media://candidate/xyz",
			"garbage",
		])
			expect(parseMediaUrl(url), url).toBeNull();
	});
});

describe("clock command handling", () => {
	const files = new Map<string, string>();
	const state = { failWrites: false };
	const layer = ClockStore.Default.pipe(
		Layer.provide(
			Layer.merge(
				Layer.succeed(ClockRoot, "/root"),
				Layer.succeed(ClockFiles, {
					read: (path) => Effect.succeed(Option.fromNullable(files.get(path))),
					writeAtomic: (path, text) =>
						state.failWrites
							? Effect.fail(ClockPersistenceFailed.fromCause(new Error("disk")))
							: Effect.sync(() => {
									files.set(path, text);
								}),
					exists: () => Effect.succeed(true),
				}),
			),
		),
	);
	const runtime = ManagedRuntime.make(layer);
	const run = (input: unknown, picked: Option.Option<string> = Option.none()) =>
		runtime.runPromise(handleClockCommand(input, Effect.succeed(picked)));

	it("rejects undecodable commands with the catalog code", async () => {
		const reply = await run({ _tag: "setMode", mode: "sideways" });
		expect(Schema.is(ClockReply)(reply)).toBe(true);
		expect(reply).toMatchObject({
			_tag: "failure",
			code: "QUAKE.CLOCK.CONFIG_INVALID",
			message: "Clock settings are invalid",
		});
	});

	it("returns DK-Suite's reason for a refused theme switch", async () => {
		expect(
			await run({ _tag: "setTheme", keyCode: "1,1", themeId: "neon" }),
		).toEqual({
			_tag: "failure",
			code: "QUAKE.CLOCK.CONFIG_INVALID",
			message: "Clock settings are invalid",
			reason: "invalid-theme",
		});
		expect(
			await run({ _tag: "setTheme", keyCode: "1,1", themeId: "anime" }),
		).toMatchObject({
			_tag: "success",
			snapshot: { themeId: "anime" },
		});
	});

	it("maps a failed save to the persistence code with DK's write-failed reason", async () => {
		state.failWrites = true;
		try {
			expect(
				await run({ _tag: "setTheme", keyCode: "1,1", themeId: "aurora" }),
			).toEqual({
				_tag: "failure",
				code: "QUAKE.CLOCK.PERSISTENCE_FAILED",
				message:
					"Clock settings could not be saved; the previous settings were kept",
				reason: "write-failed",
			});
			expect(
				await run({ _tag: "setSeconds", showSeconds: true }),
			).toMatchObject({
				_tag: "failure",
				code: "QUAKE.CLOCK.PERSISTENCE_FAILED",
			});
		} finally {
			state.failWrites = false;
		}
	});

	it("treats a cancelled dialog as no change", async () => {
		expect(await run({ _tag: "chooseMedia", themeId: "cyber" })).toMatchObject({
			_tag: "success",
		});
	});

	it("answers a picked video with a candidate URL, then a too-short error", async () => {
		const reply = await run(
			{ _tag: "chooseMedia", themeId: "cyber" },
			Option.some("/m/clip.mp4"),
		);
		expect(Schema.is(ClockReply)(reply)).toBe(true);
		if (reply._tag !== "candidate") throw new Error("expected candidate");
		expect(reply.url).toBe(`oq-clock-media://candidate/${reply.token}`);
		expect(reply.name).toBe("clip.mp4");
		expect(
			await run({ _tag: "commitMedia", token: reply.token, durationMs: 1500 }),
		).toEqual({
			_tag: "failure",
			code: "QUAKE.CLOCK.MEDIA_TOO_SHORT",
			message: "Video duration too short, should be longer than 2 seconds.",
		});
	});
});
