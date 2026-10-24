import { Either, ManagedRuntime, Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type EncodedProfileEnvelope,
	ProfileService,
} from "../../../../../packages/device/src/profiles/index.js";
import {
	PROFILES_READ,
	PROFILES_SNAPSHOT,
	ProfileSnapshotReply,
} from "../../shared/profile-snapshot-contracts";
import { stripFixtureEnvelope } from "../test/strip-fixtures";
import { isAppRenderer, ProfilesLive, registerProfiles } from "./profile-ipc";

const RENDERER = "file:///app/out/renderer/index.html";
const electron = vi.hoisted(() => {
	const mainFrame = {};
	const webContents = {
		send: vi.fn<(channel: string, value: unknown) => void>(),
		isDestroyed: () => false,
		mainFrame,
		getURL: vi.fn(() => "file:///app/out/renderer/index.html?surface=panel"),
	};
	const window = { isDestroyed: () => false, webContents };
	return {
		webContents,
		app: { on: vi.fn(), removeListener: vi.fn(), quit: vi.fn() },
		BrowserWindow: {
			getAllWindows: vi.fn(() => [window]),
			fromWebContents: vi.fn(() => window),
		},
		ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
	};
});
vi.mock("electron", () => electron);

const decode = Schema.decodeUnknownEither(ProfileSnapshotReply);
type Handler = (event: unknown) => Promise<unknown>;

function setup(read: () => Promise<unknown>, owned = true) {
	let stored: EncodedProfileEnvelope | undefined;
	const runtime = ManagedRuntime.make(
		ProfilesLive({
			read,
			write: async (envelope) => {
				stored = envelope;
			},
		}),
	);
	const registration = registerProfiles(runtime, RENDERER, owned);
	const handler = electron.ipcMain.handle.mock.calls.find(
		([channel]) => channel === PROFILES_READ,
	)?.[1];
	if (typeof handler !== "function") throw new Error("No read handler");
	const invoke: Handler = (event) => handler(event);
	const request = (
		event = {
			sender: electron.webContents,
			senderFrame: electron.webContents.mainFrame,
		},
	) => invoke(event);
	return { runtime, registration, request, stored: () => stored };
}
const pushed = () =>
	electron.webContents.send.mock.calls
		.filter(([channel]) => channel === PROFILES_SNAPSHOT)
		.map(([, value]) => decode(value));

describe("read-only profile snapshots", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});
	it("leaves an externally owned shared runtime alive after removing snapshot delivery", async () => {
		const { runtime, registration, request } = setup(
			async () => stripFixtureEnvelope(),
			false,
		);
		await request();
		await registration.dispose();
		expect(electron.app.on).not.toHaveBeenCalled();
		const loaded = await runtime.runPromise(ProfileService.loadProfiles());
		expect(loaded.envelope.profiles.length).toBeGreaterThan(0);
		await runtime.dispose();
	});

	it("answers reads, then pushes every committed snapshot to every window", async () => {
		const envelope: EncodedProfileEnvelope = {
			schemaVersion: 1,
			profiles: [
				{
					id: "p",
					name: "Empty",
					revision: 0,
					pages: [{ id: "page", keys: [] }],
				},
			],
			activeByDevice: {},
		};
		const { runtime, registration, request } = setup(async () =>
			structuredClone(envelope),
		);
		const reply = decode(await request());
		expect(Either.isRight(reply) && reply.right._tag).toBe("ready");
		await vi.waitFor(() => expect(pushed()).toHaveLength(1));
		await runtime.runPromise(
			ProfileService.saveProfile({
				expectedRevision: 0,
				profile: {
					id: "p",
					name: "Renamed",
					pages: [{ id: "page", keys: [] }],
				},
			}),
		);
		await vi.waitFor(() => expect(pushed()).toHaveLength(2));
		const latest = pushed()[1];
		expect(
			latest && Either.isRight(latest) && latest.right._tag === "ready"
				? latest.right.envelope.profiles[0].name
				: undefined,
		).toBe("Renamed");
		await registration.dispose();
		expect(electron.ipcMain.removeHandler).toHaveBeenCalledWith(PROFILES_READ);
	});

	it("delivers the fixture profiles intact", async () => {
		const { registration, request } = setup(async () => stripFixtureEnvelope());
		const reply = decode(await request());
		expect(Either.isRight(reply)).toBe(true);
		if (Either.isRight(reply) && reply.right._tag === "ready")
			expect(reply.right.envelope.profiles.map((p) => p.name)).toEqual([
				"Quick",
				"MeetAI",
				"Studio",
				"DK-Desktop-Clock",
				"Vivid",
			]);
		await registration.dispose();
	});

	it("rejects other documents and subframes", async () => {
		const { registration, request } = setup(async () => stripFixtureEnvelope());
		electron.webContents.getURL.mockReturnValueOnce("https://example.com/");
		const foreign = decode(await request());
		expect(Either.isRight(foreign) && foreign.right._tag).toBe("failure");
		const subframe = decode(
			await request({ sender: electron.webContents, senderFrame: {} }),
		);
		expect(Either.isRight(subframe) && subframe.right._tag).toBe("failure");
		expect(pushed()).toHaveLength(0);
		await registration.dispose();
	});

	it("reports unreadable storage by catalog code without the cause", async () => {
		const { registration, request } = setup(async () => {
			throw new Error("EACCES /Users/someone/secret-profiles.json");
		});
		const raw = await request();
		expect(raw).toEqual({
			_tag: "failure",
			code: "QUAKE.PROFILE.READ_FAILED",
			message: "Reading local profiles failed",
		});
		expect(JSON.stringify(raw)).not.toContain("secret");
		await registration.dispose();
	});

	it("matches only the app renderer's exact document", () => {
		expect(isAppRenderer(`${RENDERER}?surface=panel`, RENDERER)).toBe(true);
		expect(isAppRenderer("file:///other/index.html", RENDERER)).toBe(false);
		expect(isAppRenderer("not a url", RENDERER)).toBe(false);
		expect(
			isAppRenderer(
				"http://localhost:5173/?surface=panel",
				"http://localhost:5173",
			),
		).toBe(true);
	});
});
