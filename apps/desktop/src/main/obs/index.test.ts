import { EventEmitter } from "node:events";
import { BrowserWindow, ipcMain } from "electron";
import { afterEach, expect, it, vi } from "vitest";
import type { ObsCommand } from "../../../../../packages/device/src/actions/obs-contracts";
import {
	emptyObsSaved,
	type ObsVisible,
} from "../../../../../packages/edge/src/obs/obs-contracts";
import { ObsService } from "../../../../../packages/edge/src/obs/obs-service";
import { OBS_REQUEST } from "../../shared/obs";

vi.mock("electron", () => {
	let id = 0;
	return {
		app: { getPath: () => "/unused-obs-test" },
		ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
		BrowserWindow: class {
			webContents = Object.assign(new EventEmitter(), {
				id: ++id,
				mainFrame: { url: "file:///renderer/index.html" },
				isDestroyed: () => false,
				send: vi.fn(),
			});
		},
	};
});

import { prepareObs } from "./index";

afterEach(() => vi.clearAllMocks());
const shot = (sourceName: string): ObsCommand => ({
	type: "obsScreenshot",
	settings: { sourceName },
});
const fixture = () => {
	const panel = new BrowserWindow({ show: false });
	const management = new BrowserWindow({ show: false });
	let committed: readonly ObsVisible[] = [
		{ id: "1,1", command: shot("Public") },
	];
	let onRequest = async () => {};
	const request = vi.fn(async (type: string) => {
		await onRequest();
		return type === "GetSourceScreenshot"
			? { imageData: "data:image/jpeg;base64,/9j/2Q==" }
			: {};
	});
	const prepared = prepareObs({
		renderer: "file:///renderer/index.html",
		management: () => management,
		panel: () => panel,
		visibleKeys: async () => committed,
		mock: true,
		storage: {
			store: {
				read: async () => ({
					...emptyObsSaved,
					autoConnect: false,
					manualOverride: true,
				}),
				write: async () => {},
			},
			vault: {
				get: async () => "",
				put: async () => "",
				remove: async () => {},
			},
			detect: async () => undefined,
		},
		open: async () => ({
			connected: () => true,
			transitioning: () => false,
			request,
			close: () => {},
		}),
	});
	const registration = prepared.standalone();
	const handler = vi
		.mocked(ipcMain.handle)
		.mock.calls.find(([channel]) => channel === OBS_REQUEST)?.[1];
	if (!handler) throw new Error("Missing OBS IPC handler");
	const invoke = async (
		sender: BrowserWindow["webContents"],
		tiles: readonly ObsVisible[],
	) => {
		const reply: unknown = await Reflect.apply(handler, undefined, [
			{ sender, senderFrame: sender.mainFrame },
			{ type: "visible", lease: "test", tiles },
		]);
		return reply;
	};
	return {
		panel,
		management,
		prepared,
		registration,
		request,
		invoke,
		setCommitted: (tiles: readonly ObsVisible[]) => {
			committed = tiles;
		},
		onRequest: (callback: () => Promise<void>) => {
			onRequest = callback;
		},
	};
};
it("panel rejects uncommitted screenshot sources and forged key ids before OBS IO", async () => {
	const f = fixture();
	try {
		for (const tile of [
			{ id: "1,1", command: shot("Private") },
			{ id: "1,2", command: shot("Public") },
		])
			expect(await f.invoke(f.panel.webContents, [tile])).toMatchObject({
				type: "error",
			});
		await f.prepared.runtime.runPromise(ObsService.connect());
		await f.prepared.runtime.runPromise(ObsService.poll());
		expect(f.request).not.toHaveBeenCalled();
		expect(f.panel.webContents.send).not.toHaveBeenCalled();
	} finally {
		await f.registration.dispose();
	}
});
it("committed screenshots publish, then profile revocation stops further requests", async () => {
	const f = fixture();
	try {
		expect(
			await f.invoke(f.panel.webContents, [
				{ id: "1,1", command: shot("Public") },
			]),
		).toEqual({ type: "ok" });
		await f.prepared.runtime.runPromise(ObsService.connect());
		await f.prepared.runtime.runPromise(ObsService.poll());
		expect(f.request).toHaveBeenCalledTimes(1);
		expect(f.panel.webContents.send).toHaveBeenCalledTimes(1);
		f.setCommitted([]);
		await f.prepared.runtime.runPromise(ObsService.poll());
		expect(f.request).toHaveBeenCalledTimes(1);
		expect(
			vi.mocked(f.panel.webContents.send).mock.calls.at(-1)?.[1],
		).toMatchObject({ tiles: [{ connected: false, image: "" }] });
	} finally {
		await f.registration.dispose();
	}
});
it("profile changes during a screenshot read prevent its image publication", async () => {
	const f = fixture();
	try {
		await f.invoke(f.panel.webContents, [
			{ id: "1,1", command: shot("Public") },
		]);
		await f.prepared.runtime.runPromise(ObsService.connect());
		f.onRequest(async () => {
			f.setCommitted([]);
		});
		await f.prepared.runtime.runPromise(ObsService.poll());
		expect(f.request).toHaveBeenCalledTimes(1);
		for (const call of vi.mocked(f.panel.webContents.send).mock.calls)
			expect(JSON.stringify(call)).not.toContain("/9j/2Q==");
	} finally {
		await f.registration.dispose();
	}
});
it("management can preview unsaved screenshot targets", async () => {
	const f = fixture();
	try {
		expect(
			await f.invoke(f.management.webContents, [
				{ id: "1,1", command: shot("Draft") },
			]),
		).toEqual({ type: "ok" });
	} finally {
		await f.registration.dispose();
	}
});

it("panel can subscribe to committed stats with independently decoded empty settings", async () => {
	const f = fixture();
	try {
		f.setCommitted([
			{ id: "1,1", command: { type: "obsStats", settings: {} } },
		]);
		expect(
			await f.invoke(f.panel.webContents, [
				{ id: "1,1", command: { type: "obsStats", settings: {} } },
			]),
		).toEqual({ type: "ok" });
	} finally {
		await f.registration.dispose();
	}
});
