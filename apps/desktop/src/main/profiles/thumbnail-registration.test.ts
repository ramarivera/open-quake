import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cause, Effect, Option, Runtime } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translateProfile } from "../../../../../packages/device/src/profiles/profile-catalog.js";
import {
	createInitialProfileEnvelope,
	encodeProfileEnvelope,
	type Profile,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { ProfileThumbnailFailed } from "../../../../../packages/device/src/profiles/profile-errors.js";
import { ProfileManager } from "../../../../../packages/device/src/profiles/profile-manager-service.js";
import {
	PROFILE_SELECTION,
	PROFILE_SNAPSHOT,
} from "../../shared/profile-manager";
import { desktopKnobAdapters } from "../knob/desktop-adapters";
import { knobProfileBinding } from "../knob/profile-binding";
import { knobThumbnailReader } from "../knob/thumbnail-binding";
import { registerProfiles } from "./index";
import { profileThumbnailKey } from "./profile-thumbnail-key";

const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlYAAAAAASUVORK5CYII=",
	"base64",
);
const fixture = vi.hoisted(() => ({
	root: "",
	windows: [] as Array<{ destroyed: boolean; options: unknown }>,
	capture: vi.fn(),
	published: vi.fn(),
	load: vi.fn<(url: string) => Promise<void>>(),
	saved: undefined as unknown,
}));
vi.mock("./local-profile-storage", () => ({
	createDesktopProfileStorage: () => ({
		read: async () => fixture.saved,
		write: async (value: unknown) => {
			fixture.saved = value;
		},
		recoveries: [],
	}),
}));
vi.mock("./profile-ipc", () => ({
	registerProfiles: () => ({ dispose: async () => {} }),
}));
vi.mock("../key-library/registration", () => ({
	registerKeyLibrary: () => ({ dispose: async () => {} }),
}));
vi.mock("electron", () => {
	class Window {
		destroyed = false;
		constructor(readonly options: unknown) {
			fixture.windows.push(this);
		}
		webContents = {
			executeJavaScript: async () => {},
			capturePage: () => fixture.capture(),
			isDestroyed: () => this.destroyed,
			send: vi.fn(),
		};
		loadURL = (url: string) => fixture.load(url);
		isDestroyed = () => this.destroyed;
		destroy = () => {
			this.destroyed = true;
		};
		static getAllWindows = () => [
			{
				isDestroyed: () => false,
				webContents: { isDestroyed: () => false, send: fixture.published },
			},
		];
	}
	return {
		app: { getPath: () => fixture.root },
		BrowserWindow: Window,
		dialog: {},
		ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
		nativeImage: {
			createFromBuffer: (bytes: Buffer) => ({
				isEmpty: () => bytes.length < 60,
				getSize: () => ({ width: 1, height: 1 }),
			}),
		},
	};
});
const disposals: Array<() => Promise<void>> = [];
const directories: string[] = [];
afterEach(async () => {
	for (const close of disposals.splice(0)) await close();
	for (const path of directories.splice(0))
		await rm(path, { recursive: true, force: true });
	vi.unstubAllEnvs();
});
async function setup(
	deliver?: (serial: string, profile: Profile) => Promise<void>,
) {
	fixture.root = await mkdtemp(
		join(process.env.OPEN_QUAKE_TEST_SCRATCH ?? tmpdir(), "producer-"),
	);
	directories.push(fixture.root);
	fixture.saved = encodeProfileEnvelope(createInitialProfileEnvelope());
	fixture.windows.length = 0;
	fixture.load.mockResolvedValue(undefined);
	fixture.capture.mockResolvedValue({ isEmpty: () => false, toPNG: () => png });
	vi.stubEnv("OPEN_QUAKE_MOCK_DEVICE", "1");
	const profiles = registerProfiles(
		() => undefined,
		"file:///application/index.html",
		deliver,
	);
	disposals.push(profiles.dispose);
	return profiles;
}
describe("production manager thumbnail producer", () => {
	it("owns hidden serial captures, publishes to the canonical cache, and reuses it", async () => {
		const profiles = await setup();
		const first = await profiles.thumbnail(
			"1-2",
			"en",
			new AbortController().signal,
		);
		expect(first).toBe(`data:image/png;base64,${png.toString("base64")}`);
		expect(fixture.windows).toHaveLength(1);
		expect(fixture.windows[0]).toMatchObject({
			options: { show: false },
			destroyed: true,
		});
		expect(fixture.load.mock.calls[0]?.[0]).toContain(
			"surface=profile-thumbnail",
		);
		expect(
			await profiles.thumbnail("1-2", "en", new AbortController().signal),
		).toBe(first);
		expect(fixture.windows).toHaveLength(1);
		await profiles.thumbnail("1-2", "de", new AbortController().signal);
		expect(fixture.windows).toHaveLength(2);
		expect(fixture.windows.every((window) => window.destroyed)).toBe(true);
	});
	it("publishes the real manager view with corrupt cache entries and recaptures through the knob producer/reader", async () => {
		const profiles = await setup();
		// Initialize through the real producer, then corrupt its canonical file.
		const data = await profiles.thumbnail(
			"1-2",
			"en",
			new AbortController().signal,
		);
		const envelope = await profiles.runtime.runPromise(ProfileManager.read());
		const source = envelope.profiles.find((p) => p.id === "1-2");
		if (!source) throw new Error("Missing fixture profile");
		const path = join(
			fixture.root,
			"profiles",
			"thumbnails",
			`${profileThumbnailKey(translateProfile(source, "en"), "en")}.png`,
		);
		await writeFile(path, png.subarray(0, 8));
		// refresh drives controller.view and publication, the path that previously rejected every profile.
		await profiles.refresh();
		expect(
			fixture.published.mock.calls
				.filter(([channel]) => channel === PROFILE_SNAPSHOT)
				.at(-1)?.[1].thumbnails["1-2"],
		).toBe("");
		const before = fixture.windows.length;
		const adapter = desktopKnobAdapters(fixture.root, {
			profiles: knobProfileBinding(profiles.runtime, profiles.select),
			thumbnail: profiles.thumbnail,
		});
		const context = await Effect.runPromise(adapter.load);
		const target = context.profiles.find((p) => p.id === "1-2");
		if (!target) throw new Error("Missing menu fixture");
		const ready = await Effect.runPromise(
			adapter.ports.warmThumbnails([target]),
		);
		expect(ready[0]?.thumbnail).toEqual({ _tag: "ready", dataUrl: data });
		expect(fixture.windows.length).toBe(before + 1);
		expect(await readFile(path)).toEqual(png);
		await profiles.refresh();
		expect(
			fixture.published.mock.calls
				.filter(([channel]) => channel === PROFILE_SNAPSHOT)
				.at(-1)?.[1].thumbnails["1-2"],
		).toBe(data);
	});
	it("keeps filesystem failures visible through manager view and knob reader instead of recapturing", async () => {
		const profiles = await setup();
		await profiles.thumbnail("1-2", "en", new AbortController().signal);
		const envelope = await profiles.runtime.runPromise(ProfileManager.read());
		const source = envelope.profiles.find((p) => p.id === "1-2");
		if (!source) throw new Error("Missing fixture");
		const path = join(
			fixture.root,
			"profiles",
			"thumbnails",
			`${profileThumbnailKey(translateProfile(source, "en"), "en")}.png`,
		);
		await rm(path);
		await mkdir(path);
		const captured = fixture.windows.length;
		const failure: unknown = await profiles.refresh().catch((cause) => cause);
		const error = Runtime.isFiberFailure(failure)
			? Option.getOrUndefined(
					Cause.failureOption(failure[Runtime.FiberFailureCauseId]),
				)
			: failure;
		expect(error).toBeInstanceOf(ProfileThumbnailFailed);
		if (error instanceof ProfileThumbnailFailed) {
			expect(error.code).toBe("QUAKE.PROFILE.THUMBNAIL_FAILED");
			expect(error.originalCause).toMatchObject({ code: "EISDIR" });
			expect(JSON.stringify(error)).not.toContain(fixture.root);
		}
		const reader = knobThumbnailReader(join(fixture.root, "profiles"), {
			thumbnail: profiles.thumbnail,
		});
		const failed = await Effect.runPromise(
			reader(
				{
					id: source.id,
					name: source.name,
					colorful: false,
					thumbnail: { _tag: "missing" },
				},
				source,
				"en",
			).pipe(Effect.either),
		);
		expect(failed).toMatchObject({
			_tag: "Left",
			left: {
				code: "QUAKE.KNOB.DISPATCH_FAILED",
				originalCause: {
					code: "QUAKE.PROFILE.THUMBNAIL_FAILED",
					originalCause: { code: "EISDIR" },
				},
			},
		});
		expect(fixture.windows.length).toBe(captured);
		await rm(path, { recursive: true });
	});
	it("suppresses stale same-serial delivery publication after an awaited backend delivery", async () => {
		let block = false,
			started: () => void = () => {},
			finish: () => void = () => {};
		const entered = new Promise<void>((resolve) => {
			started = resolve;
		});
		const release = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const profiles = await setup(async (_serial, profile) => {
			if (block && profile.id === "1-3") {
				started();
				await release;
			}
		});
		await profiles.connect("A", "1-2");
		const before = await profiles.runtime.runPromise(ProfileManager.read());
		block = true;
		const selecting = profiles
			.select("1-3", { deviceId: "A", isCurrent: () => true })
			.then(
				() => false,
				() => true,
			);
		await entered;
		await profiles.disconnect("A");
		const reconnect = profiles.connect("A", "1-2");
		finish();
		expect(await selecting).toBe(true);
		await reconnect;
		const after = await profiles.runtime.runPromise(ProfileManager.read());
		expect(after.activeByDevice["desktop-preview"]).toEqual(
			before.activeByDevice["desktop-preview"],
		);
		expect(after.activeByDevice.A?.profileId).toBe("1-2");
		expect(
			fixture.published.mock.calls.filter(
				([channel, value]) =>
					channel === PROFILE_SELECTION && value.profile.id === "1-3",
			),
		).toEqual([]);
	});
	it("destroys the in-flight capture on caller cancellation and creates no replacement", async () => {
		const profiles = await setup();
		let started: () => void = () => {};
		const entered = new Promise<void>((resolve) => {
			started = resolve;
		});
		let finish: () => void = () => {};
		fixture.load.mockImplementationOnce(() => {
			started();
			return new Promise<void>((resolve) => {
				finish = resolve;
			});
		});
		const controller = new AbortController();
		const operation = profiles
			.thumbnail("1-2", "en", controller.signal)
			.catch((cause) => cause);
		await entered;
		controller.abort();
		await operation;
		expect(fixture.windows[0]?.destroyed).toBe(true);
		finish();
		expect(fixture.windows).toHaveLength(1);
	});
});
