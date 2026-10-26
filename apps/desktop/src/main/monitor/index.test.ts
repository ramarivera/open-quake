import { Effect, Schema } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { builtinProfiles } from "../../../../../packages/device/src/profiles/profile-catalog";
import {
	Profile,
	ProfileEnvelope,
} from "../../../../../packages/device/src/profiles/profile-contracts";
import { withMonitorKeySettings } from "../../renderer/src/strip/tiles/monitor/key-settings";
import {
	defaults,
	type MediaSlot,
	MONITOR_REQUEST,
	type MonitorReply,
} from "../../shared/monitor-contracts";

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
				) => Promise<MonitorReply>,
			) => void
		>(),
	getMedia: vi.fn(async () => ({
		bytes: new Uint8Array([1]),
		mime: "image/png",
	})),
}));
vi.mock("electron", () => ({
	BrowserWindow: class {
		static fromWebContents = () => ({});
		webContents = {
			mainFrame: {},
			getURL: () => "file:///app/index.html",
			isDestroyed: () => false,
			send: vi.fn(),
		};
		isDestroyed = () => false;
	},
	ipcMain: { handle: native.handle, removeHandler: vi.fn() },
	dialog: {},
}));
vi.mock("./monitor-store", async (original) => {
	const actual = await original<typeof import("./monitor-store")>();
	const storage = () => ({
		load: async () => ({
			revision: 1,
			settings: {
				...defaults(),
				background: "custom",
				media: { glass: other },
			},
		}),
		save: async () => {},
		putMedia: async () => {},
		getMedia: native.getMedia,
	});
	return {
		...actual,
		monitorStoreLive: () => actual.MonitorStore.Default(storage()),
	};
});
vi.mock("./native-media", () => ({ selectMedia: vi.fn() }));
vi.mock("../key-library/application-icons", () => ({
	applicationIconLibrary: () => async () => ({ icons: [] }),
}));

import { BrowserWindow } from "electron";
import { registerMonitor } from "./index";
import { activeMonitorKey } from "./panel-media";

const owned: MediaSlot = {
	id: "a".repeat(32),
	kind: "image",
	name: "owned.png",
};
const other: MediaSlot = { ...owned, id: "b".repeat(32), name: "other.png" };
beforeEach(() => vi.clearAllMocks());
describe("panel media authority at the actual IPC boundary", () => {
	it("refuses cross-profile, other-key and forged slots before reading bytes; allows the committed selected key", async () => {
		const source = builtinProfiles("linux").find((p) => p.id === "1-3");
		const key = source?.pages[0].keys[0];
		if (!source || !key) throw new Error("missing fixture");
		let envelope = Schema.decodeUnknownSync(ProfileEnvelope)({
			schemaVersion: 1,
			profiles: [source, { ...source, id: "other-profile" }].map((p) =>
				Schema.encodeSync(Profile)(p),
			),
			activeByDevice: {},
		});
		const a: Profile = {
			...source,
			pages: [
				{
					...source.pages[0],
					keys: [
						withMonitorKeySettings(key, {
							...defaults(),
							background: "custom",
							media: { glass: owned },
						}),
						withMonitorKeySettings(
							{ ...key, keyCode: "2,1" },
							{ ...defaults(), background: "custom", media: { glass: other } },
						),
					],
				},
			],
		};
		const b: Profile = {
			...source,
			id: "other-profile",
			pages: [
				{
					...source.pages[0],
					keys: [
						withMonitorKeySettings(key, {
							...defaults(),
							background: "custom",
							media: { glass: other },
						}),
					],
				},
			],
		};
		envelope = {
			...envelope,
			profiles: [a, b],
			activeByDevice: { preview: { profileId: a.id, pageId: a.pages[0].id } },
		};
		const manager = new BrowserWindow({ show: false }),
			panel = new BrowserWindow({ show: false });
		const registration = registerMonitor(
			"/monitor-test",
			() => manager,
			() => panel,
			{ collect: () => Effect.succeed({ state: "unsupported", values: {} }) },
			"file:///app/index.html",
			undefined,
			async (code) => activeMonitorKey(envelope, "preview", code),
		);
		const request = native.handle.mock.calls.find(
			([channel]) => channel === MONITOR_REQUEST,
		)?.[1];
		if (!request) throw new Error("missing handler");
		const send = (input: unknown) =>
			request(
				{ sender: panel.webContents, senderFrame: panel.webContents.mainFrame },
				input,
			);
		try {
			for (const slot of [
				other,
				{ ...owned, kind: "video" },
				{ ...owned, name: "forged" },
			]) {
				expect(
					await send({ _tag: "resolveMedia", keyCode: key.keyCode, slot }),
				).toMatchObject({
					_tag: "failure",
					code: "QUAKE.MONITOR.CONFIG_INVALID",
				});
			}
			expect(await send({ _tag: "resolveMedia", slot: owned })).toMatchObject({
				_tag: "failure",
			});
			expect(native.getMedia).not.toHaveBeenCalled();
			expect(await send({ _tag: "read" })).toMatchObject({
				_tag: "success",
				view: { media: {} },
			});
			expect(native.getMedia).not.toHaveBeenCalled();
			expect(
				await send({ _tag: "resolveMedia", keyCode: key.keyCode, slot: owned }),
			).toMatchObject({ _tag: "media", view: { available: true } });
			expect(native.getMedia).toHaveBeenCalledTimes(1);
			envelope = {
				...envelope,
				activeByDevice: { preview: { profileId: b.id, pageId: b.pages[0].id } },
			};
			expect(
				await send({ _tag: "resolveMedia", keyCode: key.keyCode, slot: owned }),
			).toMatchObject({ _tag: "failure" });
			expect(native.getMedia).toHaveBeenCalledTimes(1);
			expect(
				await send({ _tag: "resolveMedia", keyCode: key.keyCode, slot: other }),
			).toMatchObject({ _tag: "media", view: { available: true } });
		} finally {
			await registration.dispose();
		}
	});
});
