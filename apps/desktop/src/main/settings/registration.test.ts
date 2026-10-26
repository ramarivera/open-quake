import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Layer } from "effect";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsService } from "../../../../../packages/edge/src/settings/settings-service";
import { LOCALE_CHANGED, LOCALE_REQUEST } from "../../shared/locale";
import { prepareDesktopModule } from "../diagnostics/module";
import { makeDesktopRuntime } from "../diagnostics/runtime";
import { createAppLocaleBridge } from "./preload";
import { prepareAppLocale, registerAppLocale } from "./registration";

const ipc = vi.hoisted(() => ({
	handle:
		vi.fn<
			(
				channel: string,
				handler: (
					event: IpcMainInvokeEvent,
					input: unknown,
				) => Promise<unknown>,
			) => void
		>(),
	removeHandler: vi.fn(),
}));
vi.mock("electron", () => ({ ipcMain: ipc }));
afterEach(() => vi.clearAllMocks());
const renderer = "file:///application/index.html";
function windowFixture(id: number, surface: string) {
	const sender = {
		id,
		mainFrame: { url: `${renderer}?surface=${surface}` },
		getURL: () => sender.mainFrame.url,
		send: vi.fn(),
	};
	const window = {
		isDestroyed: () => false,
		webContents: sender,
	} as unknown as BrowserWindow;
	return {
		sender,
		window,
		event: () =>
			({
				sender,
				senderFrame: sender.mainFrame,
			}) as unknown as IpcMainInvokeEvent,
	};
}
describe("production locale IPC registration and durable storage", () => {
	it("drives production IPC and a second consumer through one shared owner", async () => {
		const directory = await mkdtemp(join(tmpdir(), "oq-locale-shared-"));
		const management = windowFixture(1, "management");
		const locale = prepareAppLocale({
			directory,
			osLocale: "en-US",
			renderer,
			windows: () => [management.window],
		});
		const observer = prepareDesktopModule(locale.layer, (runtime) => ({
			read: () =>
				runtime.runPromise(SettingsService.use((service) => service.locale())),
		}));
		expect(ipc.handle).not.toHaveBeenCalled();
		const application = makeDesktopRuntime(
			Layer.merge(locale.layer, observer.layer),
		);
		locale.bind(application);
		observer.bind(application);
		await application.runtime();
		const registration = locale.start();
		const consumer = observer.start();
		const bridge = createAppLocaleBridge({
			invoke: (_channel, input) => {
				const handler = ipc.handle.mock.calls.find(
					([name]) => name === LOCALE_REQUEST,
				)?.[1];
				if (!handler) throw new Error("Missing locale IPC");
				return handler(management.event(), input);
			},
			on: () => {},
			removeListener: () => {},
		});
		try {
			expect(await bridge.set("de")).toEqual({ locale: "de", revision: 1 });
			expect(await consumer.read()).toEqual({ locale: "de", revision: 1 });
			await registration.dispose();
			expect(await consumer.read()).toEqual({ locale: "de", revision: 1 });
			expect(await locale.runtime.runPromise(SettingsService)).toBe(
				await application.runPromise(SettingsService),
			);
		} finally {
			await bridge.dispose();
			await registration.dispose();
			await application.dispose();
			await rm(directory, { recursive: true, force: true });
		}
	});
	it("authenticates frames, broadcasts only to trusted windows, and keeps language across restart with changed OS seed", async () => {
		const directory = await mkdtemp(join(tmpdir(), "oq-locale-"));
		const management = windowFixture(1, "management"),
			panel = windowFixture(2, "panel"),
			foreign = windowFixture(3, "foreign");
		foreign.sender.mainFrame.url = "https://foreign.example/index.html";
		const options = {
			directory,
			osLocale: "en-US",
			renderer,
			windows: () => [management.window, panel.window, foreign.window],
		};
		let registration = registerAppLocale(options);
		const mainLocales: unknown[] = [];
		const removeLocale = registration.onLocaleChanged((snapshot) => {
			mainLocales.push(snapshot);
		});
		const handler = () => {
			const fn = [...ipc.handle.mock.calls]
				.reverse()
				.find(([name]) => name === LOCALE_REQUEST)?.[1];
			if (!fn) throw new Error("Missing locale IPC");
			return fn;
		};
		const bridge = createAppLocaleBridge({
			invoke: (_channel, input) => handler()(management.event(), input),
			on: () => {},
			removeListener: () => {},
		});
		try {
			expect(await registration.locale()).toEqual({
				locale: "en",
				revision: 0,
			});
			expect(await bridge.read()).toEqual({ locale: "en", revision: 0 });
			expect(await bridge.set("de")).toEqual({ locale: "de", revision: 1 });
			expect(await registration.locale()).toEqual({
				locale: "de",
				revision: 1,
			});
			expect(mainLocales).toEqual([{ locale: "de", revision: 1 }]);
			removeLocale();
			expect(management.sender.send).toHaveBeenLastCalledWith(LOCALE_CHANGED, {
				locale: "de",
				revision: 1,
			});
			expect(panel.sender.send).toHaveBeenLastCalledWith(LOCALE_CHANGED, {
				locale: "de",
				revision: 1,
			});
			expect(foreign.sender.send).not.toHaveBeenCalled();
			const payload = {
				_tag: "Request",
				id: "7",
				tag: "settings.setLocale",
				payload: { locale: "en" },
			};
			await expect(
				handler()(
					{
						...management.event(),
						senderFrame: { url: management.sender.mainFrame.url },
					} as IpcMainInvokeEvent,
					payload,
				),
			).rejects.toThrow("QUAKE.SETTINGS.UNAUTHORIZED");
			await expect(handler()(foreign.event(), payload)).rejects.toThrow(
				"QUAKE.SETTINGS.UNAUTHORIZED",
			);
			expect(
				JSON.parse(await readFile(join(directory, "settings-v1.json"), "utf8")),
			).toEqual({ version: 1, locale: "de", revision: 1 });
			expect(
				(await stat(join(directory, "settings-v1.json"))).mode & 0o777,
			).toBe(0o600);
			await registration.dispose();
			registration = registerAppLocale({ ...options, osLocale: "fr-FR" });
			expect(await bridge.read()).toEqual({ locale: "de", revision: 1 });
			expect(await registration.locale()).toEqual({
				locale: "de",
				revision: 1,
			});
		} finally {
			await bridge.dispose();
			await registration.dispose();
			await rm(directory, { recursive: true, force: true });
		}
	});
	it("preserves corrupt settings and surfaces read failure rather than overwriting choices", async () => {
		const directory = await mkdtemp(join(tmpdir(), "oq-locale-corrupt-"));
		const path = join(directory, "settings-v1.json"),
			original = "{corrupt-user-settings";
		await writeFile(path, original);
		const management = windowFixture(1, "management");
		const registration = registerAppLocale({
			directory,
			osLocale: "en-US",
			renderer,
			windows: () => [management.window],
		});
		try {
			const handler = [...ipc.handle.mock.calls]
				.reverse()
				.find(([name]) => name === LOCALE_REQUEST)?.[1];
			if (!handler) throw new Error("Missing handler");
			await expect(
				handler(management.event(), {
					_tag: "Request",
					id: "1",
					tag: "settings.locale",
					payload: undefined,
				}),
			).rejects.toBeDefined();
			expect(await readFile(path, "utf8")).toBe(original);
		} finally {
			await registration.dispose();
			await rm(directory, { recursive: true, force: true });
		}
	});
});
