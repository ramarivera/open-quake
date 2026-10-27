import { Effect, Fiber } from "effect";
import { beforeEach, expect, it, vi } from "vitest";
import { MediaDecoder } from "./media-decoder";

const native = vi.hoisted(() => ({
	metadata: vi.fn<() => Promise<unknown>>(),
	options: vi.fn(),
	mute: vi.fn(),
	destroy: vi.fn(),
	image: vi.fn(),
}));
vi.mock("electron", () => ({
	BrowserWindow: class {
		destroyed = false;
		constructor(options: unknown) {
			native.options(options);
		}
		webContents = {
			setAudioMuted: native.mute,
			executeJavaScript: native.metadata,
		};
		loadURL = async () => undefined;
		isDestroyed = () => this.destroyed;
		destroy = () => {
			this.destroyed = true;
			native.destroy();
		};
	},
	nativeImage: { createFromBuffer: native.image },
}));
const headers = [
	{
		format: "video/mp4",
		bytes: Buffer.from([0, 0, 0, 16, ...Buffer.from("ftypisom")]),
	},
	{
		format: "video/quicktime",
		bytes: Buffer.from([0, 0, 0, 16, ...Buffer.from("ftypqt  ")]),
	},
	{ format: "video/webm", bytes: Buffer.from([0x1a, 0x45, 0xdf, 0xa3]) },
	{
		format: "video/x-matroska",
		bytes: Buffer.concat([
			Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
			Buffer.from("matroska"),
		]),
	},
	{ format: "video/x-msvideo", bytes: Buffer.from("RIFF0000AVI ") },
] as const;
beforeEach(() => {
	vi.clearAllMocks();
	native.metadata.mockResolvedValue({
		width: 320,
		height: 80,
		durationMs: 3000,
	});
});
const decode = (bytes: Buffer) =>
	Effect.gen(function* () {
		const decoder = yield* MediaDecoder;
		return yield* decoder.decode(bytes);
	}).pipe(Effect.provide(MediaDecoder.Default));

it.each(headers)(
	"decodes $format metadata in a hidden muted worker and closes it",
	async ({ format, bytes }) => {
		expect(await Effect.runPromise(decode(bytes))).toMatchObject({
			format,
			width: 320,
			height: 80,
			durationMs: 3000,
		});
		expect(native.options).toHaveBeenCalledWith(
			expect.objectContaining({ show: false, focusable: false }),
		);
		expect(native.mute).toHaveBeenCalledWith(true);
		expect(native.destroy).toHaveBeenCalledOnce();
		expect(native.image).not.toHaveBeenCalled();
	},
);
it.each([
	{ width: 320, height: 80, durationMs: 1999 },
	{ width: 320, height: 80, durationMs: Number.POSITIVE_INFINITY },
	{ width: 0, height: 80, durationMs: 3000 },
	{ width: 9000, height: 9000, durationMs: 3000 },
])(
	"rejects invalid metadata and still closes the worker: %j",
	async (metadata) => {
		native.metadata.mockResolvedValue(metadata);
		expect(
			await Effect.runPromise(decode(headers[0].bytes).pipe(Effect.either)),
		).toMatchObject({ _tag: "Left", left: { _tag: "MediaUnreadable" } });
		expect(native.destroy).toHaveBeenCalledOnce();
	},
);
it("maps native decoder failure and destroys the worker", async () => {
	native.metadata.mockRejectedValue(new Error("codec-unavailable"));
	expect(
		await Effect.runPromise(decode(headers[0].bytes).pipe(Effect.either)),
	).toMatchObject({ _tag: "Left", left: { _tag: "MediaUnreadable" } });
	expect(native.destroy).toHaveBeenCalledOnce();
});
it("destroys a pending metadata worker on interruption", async () => {
	let entered: () => void = () => {};
	const ready = new Promise<void>((resolve) => {
		entered = resolve;
	});
	native.metadata.mockImplementation(() => {
		entered();
		return new Promise(() => {});
	});
	const fiber = Effect.runFork(decode(headers[0].bytes));
	await ready;
	await Effect.runPromise(Fiber.interrupt(fiber));
	expect(native.destroy).toHaveBeenCalledOnce();
});

it("serves cached metadata while an unrelated video probe is pending", async () => {
	let entered: () => void = () => {};
	const ready = new Promise<void>((resolve) => {
		entered = resolve;
	});
	let resume: (value: unknown) => void = () => {};
	await Effect.runPromise(
		Effect.gen(function* () {
			const decoder = yield* MediaDecoder;
			yield* decoder.decode(headers[0].bytes);
			native.metadata.mockImplementationOnce(() => {
				entered();
				return new Promise((resolve) => {
					resume = resolve;
				});
			});
			const pending = yield* Effect.fork(decoder.decode(headers[2].bytes));
			yield* Effect.promise(() => ready);
			const cached = yield* decoder
				.decode(headers[0].bytes)
				.pipe(Effect.timeoutOption(100));
			resume({ width: 320, height: 80, durationMs: 3000 });
			yield* Fiber.join(pending);
			expect(cached._tag).toBe("Some");
			expect(native.metadata).toHaveBeenCalledTimes(2);
		}).pipe(Effect.provide(MediaDecoder.Default)),
	);
});

it("WIDGETS-128 accepts a decoded GIF without a video probe and rejects corrupt GIF data", async () => {
	const bytes = Buffer.from("GIF89a000000000");
	native.image.mockReturnValueOnce({
		isEmpty: () => false,
		getSize: () => ({ width: 320, height: 80 }),
	});
	expect(await Effect.runPromise(decode(bytes))).toMatchObject({
		format: "image/gif",
		width: 320,
		height: 80,
	});
	expect(native.metadata).not.toHaveBeenCalled();
	native.image.mockReturnValueOnce({
		isEmpty: () => true,
		getSize: () => ({ width: 0, height: 0 }),
	});
	expect(
		await Effect.runPromise(decode(bytes).pipe(Effect.either)),
	).toMatchObject({ _tag: "Left", left: { _tag: "MediaUnreadable" } });
});
