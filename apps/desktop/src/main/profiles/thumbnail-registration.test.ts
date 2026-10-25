import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createInitialProfileEnvelope,
	encodeProfileEnvelope,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { registerProfiles } from "./index";

const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlYAAAAAASUVORK5CYII=",
	"base64",
);
const fixture = vi.hoisted(() => ({
	root: "",
	windows: [] as Array<{ destroyed: boolean; options: unknown }>,
	capture: vi.fn(),
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
		static getAllWindows = () => [];
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
async function setup() {
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
