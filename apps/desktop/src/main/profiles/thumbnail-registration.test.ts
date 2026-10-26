import * as filesystem from "node:fs/promises";
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
import {
	createDesktopDiagnostics,
	type DesktopDiagnostics,
} from "../diagnostics";
import { desktopKnobAdapters } from "../knob/desktop-adapters";
import { knobProfileBinding } from "../knob/profile-binding";
import { knobThumbnailReader } from "../knob/thumbnail-binding";
import { registerProfiles } from "./index";
import { profileThumbnailKey } from "./profile-thumbnail-key";

const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlYAAAAAASUVORK5CYII=",
	"base64",
);
vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return { ...actual, unlink: vi.fn(actual.unlink) };
});
const fixture = vi.hoisted(() => ({
	root: "",
	windows: [] as Array<{ destroyed: boolean; options: unknown }>,
	capture: vi.fn(),
	ready: vi.fn<(source: string) => Promise<unknown>>(),
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
			executeJavaScript: (source: string) => fixture.ready(source),
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
	prepare?: (root: string) => Promise<void>,
	diagnostics?: DesktopDiagnostics,
) {
	fixture.root = await mkdtemp(
		join(process.env.OPEN_QUAKE_TEST_SCRATCH ?? tmpdir(), "producer-"),
	);
	directories.push(fixture.root);
	fixture.saved = encodeProfileEnvelope(createInitialProfileEnvelope());
	fixture.windows.length = 0;
	fixture.load.mockResolvedValue(undefined);
	fixture.ready.mockResolvedValue(undefined);
	fixture.capture.mockResolvedValue({ isEmpty: () => false, toPNG: () => png });
	await prepare?.(fixture.root);
	vi.stubEnv("OPEN_QUAKE_MOCK_DEVICE", "1");
	const profiles = registerProfiles(
		() => undefined,
		"file:///application/index.html",
		deliver,
		undefined,
		undefined,
		undefined,
		undefined,
		diagnostics,
	);
	disposals.push(profiles.dispose);
	return profiles;
}
describe("production manager thumbnail producer", () => {
	it("cleans startup orphans and edited captures through actual profile commits while retaining other locales", async () => {
		const obsolete = `${"a".repeat(64)}.png`;
		const nativeUnlink = (
			await vi.importActual<typeof import("node:fs/promises")>(
				"node:fs/promises",
			)
		).unlink;
		let startupDeleted: () => void = () => {};
		const startupDeletion = new Promise<void>((resolve) => {
			startupDeleted = resolve;
		});
		const startupUnlink = vi
			.spyOn(filesystem, "unlink")
			.mockImplementation(async (path) => {
				await nativeUnlink(path);
				if (String(path).endsWith(obsolete)) startupDeleted();
			});
		const profiles = await setup(undefined, async (root) => {
			await mkdir(join(root, "profiles", "thumbnails"), { recursive: true });
			await writeFile(join(root, "profiles", "thumbnails", obsolete), png);
		});
		const cache = join(fixture.root, "profiles", "thumbnails");
		try {
			await profiles.refresh();
			await startupDeletion;
			expect(await readdir(cache)).not.toContain(obsolete);
		} finally {
			startupUnlink.mockRestore();
		}
		await profiles.thumbnail("1-2", "de", new AbortController().signal);
		const original = await profiles.runtime.runPromise(ProfileManager.read());
		const manager = await profiles.runtime.runPromise(ProfileManager);
		const created = await profiles.runtime.runPromise(
			manager.command({ type: "create" }),
		);
		if (created._tag !== "updated") throw new Error("Create fixture rejected");
		const custom = created.envelope.profiles.find(
			(p) => !original.profiles.some((old) => old.id === p.id),
		);
		if (!custom) throw new Error("Missing custom fixture");
		await profiles.thumbnail(custom.id, "en", new AbortController().signal);
		const before = `${profileThumbnailKey(translateProfile(custom, "en"), "en")}.png`;
		expect(await readdir(cache)).toContain(before);
		const native =
			await vi.importActual<typeof import("node:fs/promises")>(
				"node:fs/promises",
			);
		let deleted: () => void = () => {};
		const deletion = new Promise<void>((resolve) => {
			deleted = resolve;
		});
		const unlink = vi
			.spyOn(filesystem, "unlink")
			.mockImplementation(async (path) => {
				await native.unlink(path);
				if (String(path).endsWith(before)) deleted();
			});
		try {
			await profiles.runtime.runPromise(
				manager.command({ type: "rename", id: custom.id, name: "Changed" }),
			);
			await deletion;
			expect(await readdir(cache)).not.toContain(before);
		} finally {
			unlink.mockRestore();
		}
		const retained = original.profiles.find((p) => p.id === "1-2");
		if (!retained) throw new Error("Missing retained fixture");
		expect(await readdir(cache)).toContain(
			`${profileThumbnailKey(translateProfile(retained, "de"), "de")}.png`,
		);
	});

	it("logs cleanup failures through the owning runtime without preventing snapshot publication", async () => {
		const diagnosticRoot = await mkdtemp(
			join(
				process.env.OPEN_QUAKE_TEST_SCRATCH ?? tmpdir(),
				"thumbnail-diagnostics-",
			),
		);
		directories.push(diagnosticRoot);
		const diagnostics = createDesktopDiagnostics({ directory: diagnosticRoot });
		const obsolete = `${"a".repeat(64)}.png`;
		const nativeFailure = Object.assign(new Error("private-name-sentinel"), {
			code: "EACCES",
		});
		const original =
			await vi.importActual<typeof import("node:fs/promises")>(
				"node:fs/promises",
			);
		const unlink = vi
			.spyOn(filesystem, "unlink")
			.mockImplementation(async (path) => {
				if (String(path).endsWith(obsolete)) throw nativeFailure;
				return original.unlink(path);
			});
		try {
			let published: () => void = () => {};
			const publication = new Promise<void>((resolve) => {
				published = resolve;
			});
			fixture.published.mockImplementation((channel) => {
				if (channel === PROFILE_SNAPSHOT) published();
			});
			const profiles = await setup(
				undefined,
				async (root) => {
					await mkdir(join(root, "profiles", "thumbnails"), {
						recursive: true,
					});
					await writeFile(join(root, "profiles", "thumbnails", obsolete), png);
				},
				diagnostics,
			);
			await publication;
			await profiles.dispose();
			const status = await diagnostics.close();
			expect(status.dropped).toBe(0);
			const files = (await readdir(diagnosticRoot)).filter((name) =>
				name.endsWith(".ndjson"),
			);
			const raw = (
				await Promise.all(
					files.map((name) => readFile(join(diagnosticRoot, name), "utf8")),
				)
			).join("");
			const records: Array<Record<string, unknown>> = raw
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));
			const warning = records.find(
				(record) => record.event === "profiles.thumbnail.cleanup.failed",
			);
			expect(warning).toMatchObject({
				level: "WARN",
				span_name: "ProfileDesktop.pruneThumbnails",
				errors: [
					{
						code: "QUAKE.PROFILE.THUMBNAIL_FAILED",
						cause: expect.objectContaining({ sourceCode: "EACCES" }),
					},
				],
			});
			expect(warning?.trace_id).toMatch(/^[0-9a-f]{32}$/);
			expect(raw).not.toMatch(
				/private-name-sentinel|thumbnails-|SCRATCHPADS_FOR_AGENTS/,
			);
		} finally {
			unlink.mockRestore();
			fixture.published.mockReset();
			await diagnostics.close();
		}
	});

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

it("waits for asynchronous owned tile artwork and decoded images before capturing", async () => {
	const profiles = await setup();
	const checks: Array<() => void> = [];
	const image = { complete: false, naturalWidth: 0 };
	const tile = {
		dataset: { tileArtworkState: "pending" },
		querySelectorAll: () => [image],
	};
	const preview = {
		clientWidth: 960,
		clientHeight: 240,
		querySelector: (selector: string) =>
			selector === ".strip-viewport-stage"
				? { getBoundingClientRect: () => ({ width: 960 }) }
				: {},
		querySelectorAll: (selector: string) =>
			selector === "[data-tile-artwork-state]" ? [tile] : [],
	};
	fixture.ready.mockImplementationOnce((source) =>
		new Function(
			"document",
			"requestAnimationFrame",
			"setTimeout",
			`return ${source}`,
		)(
			{ querySelector: () => preview, fonts: { ready: Promise.resolve() } },
			(callback: () => void) => callback(),
			(callback: () => void, delay: number) => {
				if (delay === 20) checks.push(callback);
			},
		),
	);
	fixture.capture.mockClear();
	const pending = profiles.thumbnail("1-2", "en", new AbortController().signal);
	await vi.waitFor(() => expect(fixture.ready).toHaveBeenCalled());
	expect(fixture.capture).not.toHaveBeenCalled();
	expect(checks.length).toBe(1);
	tile.dataset.tileArtworkState = "ready";
	checks.shift()?.();
	await Promise.resolve();
	expect(fixture.capture).not.toHaveBeenCalled();
	image.complete = true;
	image.naturalWidth = 170;
	checks.shift()?.();
	await pending;
	expect(fixture.capture).toHaveBeenCalledOnce();
});
