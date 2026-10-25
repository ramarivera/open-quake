import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
	root: "",
	failWindow: false,
	failWrite: false,
	windows: [] as { url: string; destroyed: boolean }[],
	contents: [] as unknown[],
	sessions: [] as {
		request: (...args: unknown[]) => unknown;
		check: (...args: unknown[]) => unknown;
	}[],
}));
vi.mock("node:fs/promises", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...fs,
		writeFile: (...args: Parameters<typeof fs.writeFile>) =>
			native.failWrite
				? Promise.reject(new Error("synthetic write failure"))
				: fs.writeFile(...args),
	};
});
vi.mock("electron", () => ({
	app: { getPath: () => native.root },
	systemPreferences: {},
	session: {
		fromPartition: () => {
			const state = { request: () => {}, check: () => {} };
			native.sessions.push(state);
			return {
				setPermissionRequestHandler: (fn: (...args: unknown[]) => unknown) => {
					state.request = fn;
				},
				setPermissionCheckHandler: (fn: (...args: unknown[]) => unknown) => {
					state.check = fn;
				},
			};
		},
	},
	BrowserWindow: class {
		state = { url: "", destroyed: false };
		constructor() {
			if (native.failWindow) throw new Error("synthetic window failure");
			native.windows.push(this.state);
			native.contents.push(this.webContents);
		}
		webContents = {
			setWindowOpenHandler: () => {},
			on: () => {},
			getURL: () => this.state.url,
			executeJavaScript: async () => {},
		};
		isDestroyed() {
			return this.state.destroyed;
		}
		destroy() {
			this.state.destroyed = true;
		}
		async loadURL(url: string) {
			this.state.url = url;
		}
	},
}));

import { openAudioWorker } from "./electron-audio";

beforeEach(async () => {
	native.root = await mkdtemp(join(tmpdir(), "oq-audio-test-"));
	native.failWrite = false;
	native.failWindow = false;
	native.windows.length = 0;
	native.sessions.length = 0;
	native.contents.length = 0;
});
afterEach(async () => {
	await rm(native.root, { recursive: true });
});
describe("owned Electron audio worker", () => {
	it.each(["write", "window"])(
		"removes its private directory when %s setup fails",
		async (failure) => {
			native.failWrite = failure === "write";
			native.failWindow = failure === "window";
			await expect(
				openAudioWorker(new AbortController().signal),
			).rejects.toThrow();
			expect(await readdir(native.root)).toEqual([]);
		},
	);
	it("grants audio only to the exact top-level worker and denies child frames/other URLs", async () => {
		const worker = await openAudioWorker(new AbortController().signal);
		const state = native.windows[0];
		const policy = native.sessions[0];
		if (!state || !policy) throw new Error("worker");
		// Contents identity is kept in the registered closure. Obtain it through the mocked instance below.
		const instance = native.contents[0];
		const ask = (details: unknown, contents: unknown = instance) => {
			let result: unknown;
			policy.request(
				contents,
				"media",
				(allowed: boolean) => {
					result = allowed;
				},
				details,
			);
			return result;
		};
		expect(
			ask({
				isMainFrame: true,
				requestingUrl: state.url,
				mediaTypes: ["audio"],
			}),
		).toBe(true);
		expect(
			ask({
				isMainFrame: false,
				requestingUrl: state.url,
				mediaTypes: ["audio"],
			}),
		).toBe(false);
		expect(
			ask({
				isMainFrame: true,
				requestingUrl: "https://other.invalid",
				mediaTypes: ["audio"],
			}),
		).toBe(false);
		expect(
			ask({
				isMainFrame: true,
				requestingUrl: state.url,
				mediaTypes: ["video"],
			}),
		).toBe(false);
		expect(
			ask({ isMainFrame: true, requestingUrl: state.url, mediaTypes: [] }),
		).toBe(false);
		expect(
			ask(
				{ isMainFrame: true, requestingUrl: state.url, mediaTypes: ["audio"] },
				{},
			),
		).toBe(false);
		await worker.close();
		expect(state.destroyed).toBe(true);
		expect(await readdir(native.root)).toEqual([]);
	});
});
