import { Effect } from "effect";
import { expect, it, vi } from "vitest";
import { makeAudioOutput } from "../../../../../packages/edge/src/audio/output-service";
import { wallpaperAudioSession } from "./wallpaper-audio";

it("uses the canonical output lease, lets soundboard and capture preempt, and never auto-resumes", async () => {
	const output = await Effect.runPromise(makeAudioOutput);
	const mute = vi.fn(async () => undefined),
		unmute = vi.fn();
	const audio = wallpaperAudioSession((mute) =>
		Effect.runPromise(output.acquire("wallpaper", Effect.promise(mute))),
	);
	expect(await audio.start("a", mute, unmute)).toBe(true);
	expect(unmute).toHaveBeenCalledOnce();
	const board = await Effect.runPromise(
		output.acquire("soundboard", Effect.void),
	);
	expect(mute).toHaveBeenCalledOnce();
	const capture = await Effect.runPromise(
		output.acquire("capture", Effect.void),
	);
	await audio.stop("a");
	expect(await Effect.runPromise(capture.current)).toBe(true);
	await Effect.runPromise(board.release);
	expect(await Effect.runPromise(capture.current)).toBe(true);
	await Effect.runPromise(capture.release);
	expect(unmute).toHaveBeenCalledOnce();
	await audio.close();
	await Effect.runPromise(output.close());
});

it("a late stop for an old wallpaper cannot mute the replacement", async () => {
	const output = await Effect.runPromise(makeAudioOutput);
	const mute = vi.fn(async () => undefined),
		unmute = vi.fn();
	const audio = wallpaperAudioSession((mute) =>
		Effect.runPromise(output.acquire("wallpaper", Effect.promise(mute))),
	);
	await audio.start("old", mute, unmute);
	await audio.start("new", mute, unmute);
	expect(mute).toHaveBeenCalledOnce();
	await audio.stop("old");
	expect(mute).toHaveBeenCalledOnce();
	await audio.close();
	expect(mute).toHaveBeenCalledTimes(2);
	expect(await audio.start("after-close", mute, unmute)).toBe(false);
	await Effect.runPromise(output.close());
});

it("finishes cancelled acquisition cleanup before a successor can unmute", async () => {
	const output = await Effect.runPromise(makeAudioOutput);
	let acquired: () => void = () => {};
	const waiting = new Promise<void>((resolve) => {
		acquired = resolve;
	});
	let resume: () => void = () => {};
	const blocked = new Promise<void>((resolve) => {
		resume = resolve;
	});
	let first = true;
	const order: string[] = [];
	const audio = wallpaperAudioSession(async (mute) => {
		const lease = await Effect.runPromise(
			output.acquire("wallpaper", Effect.promise(mute)),
		);
		if (first) {
			first = false;
			acquired();
			await blocked;
		}
		return lease;
	});
	const old = audio.start(
		"old",
		async () => {
			order.push("mute-old");
		},
		() => order.push("unmute-old"),
	);
	await waiting;
	const next = audio.start(
		"next",
		async () => {
			order.push("mute-next");
		},
		() => order.push("unmute-next"),
	);
	resume();
	expect(await old).toBe(false);
	expect(await next).toBe(true);
	expect(order).toEqual(["mute-old", "unmute-next"]);
	await audio.close();
	expect(order).toEqual(["mute-old", "unmute-next", "mute-next"]);
	await Effect.runPromise(output.close());
});

it.each(["close", "ineligible"] as const)(
	"never unmutes a pending request after %s",
	async (mode) => {
		const output = await Effect.runPromise(makeAudioOutput);
		let acquired: () => void = () => {};
		const waiting = new Promise<void>((resolve) => {
			acquired = resolve;
		});
		let resume: () => void = () => {};
		const blocked = new Promise<void>((resolve) => {
			resume = resolve;
		});
		let eligible = true;
		const mute = vi.fn(async () => undefined),
			unmute = vi.fn();
		const audio = wallpaperAudioSession(async (stop) => {
			const lease = await Effect.runPromise(
				output.acquire("wallpaper", Effect.promise(stop)),
			);
			acquired();
			await blocked;
			return lease;
		});
		const start = audio.start("pending", mute, unmute, () => eligible);
		await waiting;
		eligible = false;
		const close = mode === "close" ? audio.close() : Promise.resolve();
		resume();
		expect(await start).toBe(false);
		await close;
		expect(unmute).not.toHaveBeenCalled();
		expect(mute).toHaveBeenCalledOnce();
		await audio.close();
		await Effect.runPromise(output.close());
	},
);
