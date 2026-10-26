import { Effect, ManagedRuntime, Option } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClockReply, ClockTarget } from "../../shared/clock-contracts";

const native = vi.hoisted(() => ({
	handle:
		vi.fn<
			(
				channel: string,
				handler: (
					event: {
						sender: Electron.WebContents;
						senderFrame: Electron.WebFrameMain;
					},
					input: unknown,
				) => Promise<ClockReply>,
			) => void
		>(),
	before:
		vi.fn<
			(
				filter: unknown,
				handler?: (
					details: {
						url: string;
						webContents: Electron.WebContents;
						frame: Electron.WebFrameMain;
						resourceType: string;
					},
					callback: (result: { cancel: boolean }) => void,
				) => void,
			) => void
		>(),
	protocol:
		vi.fn<
			(scheme: string, handler: (request: Request) => Promise<Response>) => void
		>(),
	fetch: vi.fn(async () => new Response("private image")),
	windows: vi.fn<() => Electron.BrowserWindow[]>(() => []),
	reply: undefined as ClockReply | undefined,
	mediaPath: vi.fn(),
}));
vi.mock("electron", () => ({
	BrowserWindow: class {
		static getAllWindows = native.windows;
		static fromWebContents = () => ({});
		webContents = {
			id: Math.random(),
			mainFrame: { url: "file:///app/index.html" },
			getURL: () => "file:///app/index.html",
			isDestroyed: () => false,
			send: vi.fn(),
			on: vi.fn(),
			once: vi.fn(),
			removeListener: vi.fn(),
		};
		isDestroyed = () => false;
	},
	ipcMain: { handle: native.handle, removeHandler: vi.fn() },
	protocol: { handle: native.protocol, unhandle: vi.fn() },
	session: {
		defaultSession: { webRequest: { onBeforeRequest: native.before } },
	},
	net: { fetch: native.fetch },
	dialog: {},
}));
vi.mock("./native-video-probe", () => ({
	isClockVideoProbe: () => false,
	probeClockVideo: () => Effect.succeed(3000),
}));
vi.mock("./clock-store", async (original) => {
	const actual = await original<typeof import("./clock-store")>();
	return {
		...actual,
		ClockStore: class extends actual.ClockStore {
			static mediaPath(
				target: Parameters<typeof actual.ClockStore.mediaPath>[0],
			) {
				native.mediaPath(target);
				return Effect.succeed(Option.some("/private/image.png"));
			}
		},
	};
});
vi.mock("./clock-ipc", async (original) => ({
	...(await original<typeof import("./clock-ipc")>()),
	handleClockCommand: () => Effect.succeed(native.reply),
}));

import { BrowserWindow } from "electron";
import { ClockLive, registerClock } from "./index";

const a = { profileId: "a", pageId: "page", keyCode: "1,1" };
const b = { ...a, profileId: "b" };
function reply(target: ClockTarget): ClockReply {
	return {
		_tag: "success",
		snapshot: {
			target,
			revision: 1,
			keyCode: "1,1",
			mode: "theme",
			themeId: "season",
			showSeconds: false,
			recovered: false,
			media: {
				season: {
					kind: "image",
					name: "image.png",
					available: true,
					url: `oq-clock-media://theme/season?r=1&t=${encodeURIComponent(JSON.stringify(target))}`,
				},
			},
		},
	};
}
async function setup() {
	const manager = new BrowserWindow({ show: false });
	const panel = new BrowserWindow({ show: false });
	let active = a;
	const runtime = ManagedRuntime.make(ClockLive("/clock-test"));
	// Command and file effects are injected above; this runtime executes the actual registration boundary.
	const registration = registerClock(
		runtime,
		() => manager,
		"file:///app/index.html",
		{ panel: () => panel, target: async () => active },
	);
	const command = native.handle.mock.calls[0]?.[1];
	const before = native.before.mock.calls[0]?.[1];
	const serve = native.protocol.mock.calls[0]?.[1];
	if (!command || !before || !serve)
		throw new Error("missing clock registration");
	const read = async (window: BrowserWindow, target: ClockTarget) => {
		native.reply = reply(target);
		const response = await command(
			{ sender: window.webContents, senderFrame: window.webContents.mainFrame },
			{ _tag: "read", target },
		);
		if (response._tag !== "success") throw new Error("read rejected");
		return response.snapshot.media.season?.url ?? "";
	};
	const allowed = async (window: BrowserWindow, url: string) =>
		new Promise<boolean>((resolve) =>
			before(
				{
					url,
					webContents: window.webContents,
					frame: window.webContents.mainFrame,
					resourceType: "image",
				},
				(result) => resolve(!result.cancel),
			),
		);
	return {
		manager,
		panel,
		read,
		allowed,
		serve,
		registration,
		switchTo: (target: ClockTarget) => {
			active = target;
		},
	};
}
beforeEach(() => vi.clearAllMocks());
describe("clock media window and target authority", () => {
	it("refuses another window's target URL and raw target selectors", async () => {
		const s = await setup();
		try {
			const managerUrl = await s.read(s.manager, b);
			const panelUrl = await s.read(s.panel, a);
			expect(await s.allowed(s.panel, managerUrl)).toBe(false);
			expect(await s.allowed(s.manager, panelUrl)).toBe(false);
			expect(
				await s.allowed(
					s.panel,
					`oq-clock-media://theme/season?r=1&t=${encodeURIComponent(JSON.stringify(b))}`,
				),
			).toBe(false);
			expect(panelUrl).toMatch(/^oq-clock-media:\/\/ref\/[a-f0-9]{64}$/);
		} finally {
			await s.registration.dispose();
		}
	});
	it("serves the owner's target, revokes old targets and never grants wildcard CORS", async () => {
		const s = await setup();
		try {
			const url = await s.read(s.panel, a);
			expect(await s.allowed(s.panel, url)).toBe(true);
			const response = await s.serve(
				new Request(url, { headers: { Origin: "null" } }),
			);
			expect(await response.text()).toBe("private image");
			expect(response.headers.get("Access-Control-Allow-Origin")).not.toBe("*");
			expect(native.mediaPath).toHaveBeenCalledWith({
				theme: "season",
				target: a,
			});
			s.switchTo(b);
			expect(await s.allowed(s.panel, url)).toBe(false);
			const managerUrl = await s.read(s.manager, a);
			await s.read(s.manager, b);
			expect(await s.allowed(s.manager, managerUrl)).toBe(false);
		} finally {
			await s.registration.dispose();
		}
	});
});
