import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsOsApplyFailed } from "../../../../../packages/edge/src/settings/settings-errors";
import type {
	SettingsOsPort,
	WizardOwners,
} from "../../../../../packages/edge/src/settings/settings-ports";
import { LOCALE_CHANGED, LOCALE_REQUEST } from "../../shared/locale";
import { SETTINGS_BACKEND_REQUEST } from "../../shared/settings-backend";
import { createDesktopDiagnostics } from "../diagnostics";
import { createSettingsBackendBridge } from "./backend-preload";
import { createAppLocaleBridge } from "./preload";
import { registerAppLocale } from "./registration";

type Handler = (event: IpcMainInvokeEvent, input: unknown) => Promise<unknown>;
const ipc = vi.hoisted(() => ({
	handle: vi.fn<(channel: string, handler: Handler) => void>(),
	removeHandler: vi.fn(),
}));
vi.mock("electron", () => ({ ipcMain: ipc }));
afterEach(() => vi.clearAllMocks());
const renderer = "file:///app/index.html";
function fixture(id: number, surface: string) {
	const sender = {
		id,
		mainFrame: { url: `${renderer}?surface=${surface}` },
		getURL: () => sender.mainFrame.url,
		send: vi.fn(),
	};
	return {
		sender,
		window: {
			isDestroyed: () => false,
			webContents: sender,
		} as unknown as BrowserWindow,
		event: () =>
			({
				sender,
				senderFrame: sender.mainFrame,
			}) as unknown as IpcMainInvokeEvent,
	};
}
async function setup() {
	const directory = await mkdtemp(join(tmpdir(), "oq-settings-backend-"));
	const management = fixture(1, "management"),
		panel = fixture(2, "panel");
	const diagnostics = createDesktopDiagnostics({
		directory: join(directory, "diagnostics"),
	});
	let login = false;
	const nativeWrite = vi.fn<
		(value: boolean) => Effect.Effect<void, SettingsOsApplyFailed>
	>((value) =>
		Effect.sync(() => {
			login = value;
		}),
	);
	const os: typeof SettingsOsPort.Service = {
		login: () => Effect.succeed(login),
		setLogin: nativeWrite,
		workAreas: () => Effect.succeed([{ x: 0, y: 0, width: 1280, height: 800 }]),
		managementReachable: () => Effect.succeed(true),
	};
	const owners: typeof WizardOwners.Service = {
		displayAvailable: () => Effect.succeed(false),
		usableProfiles: (ids) =>
			Effect.succeed(ids.length === 1 && ids[0] === "local"),
		runtimeSupported: Effect.succeed(true),
		runtimeConfigured: Effect.succeed(false),
		regionSuggestions: () => Effect.succeed({}),
	};
	const options = {
		diagnostics,
		directory,
		osLocale: "en-US",
		renderer,
		windows: () => [management.window, panel.window],
		backend: { os, owners },
	};
	let registration = registerAppLocale(options);
	const handler = (channel: string) => {
		const h = [...ipc.handle.mock.calls]
			.reverse()
			.find(([name]) => name === channel)?.[1];
		if (!h) throw new Error("Missing settings handler");
		return h;
	};
	const transport = {
		invoke: (channel: string, input: unknown) =>
			handler(channel)(management.event(), input),
		on: () => {},
		removeListener: () => {},
	};
	const bridge = createSettingsBackendBridge(transport),
		locale = createAppLocaleBridge(transport);
	return {
		directory,
		management,
		panel,
		bridge,
		locale,
		os,
		nativeWrite,
		handler,
		restart: async () => {
			await registration.dispose();
			registration = registerAppLocale({ ...options, osLocale: "de-DE" });
		},
		close: async () => {
			await Promise.all([bridge.dispose(), locale.dispose()]);
			await registration.dispose();
			await diagnostics.close();
			await rm(directory, { recursive: true, force: true });
		},
		diagnosticRecords: async () => {
			await diagnostics.flush();
			return readFile(
				join(directory, "diagnostics", "diagnostics.0.ndjson"),
				"utf8",
			);
		},
	};
}
describe("real settings RPC/preload and canonical repository", () => {
	it("resumes and completes offline setup, shares locale revision, preserves preferences and never writes login for hidden startup", async () => {
		const f = await setup();
		try {
			expect(await f.bridge.general()).toMatchObject({
				startHidden: false,
				launchAtLogin: false,
			});
			await f.bridge.saveGeneral({ startHidden: true });
			expect(f.nativeWrite).not.toHaveBeenCalled();
			await f.bridge.saveWizard({
				step: "display",
				locale: "de",
				region: "DE",
				display: { _tag: "desktop-preview" },
				profileIds: ["local"],
			});
			expect(await f.locale.read()).toMatchObject({
				locale: "de",
				revision: 2,
			});
			expect(f.panel.sender.send).toHaveBeenCalledWith(LOCALE_CHANGED, {
				locale: "de",
				revision: 2,
			});
			await expect(f.bridge.completeWizard()).rejects.toMatchObject({
				code: "QUAKE.WIZARD.INCOMPLETE",
			});
			await f.restart();
			expect(await f.bridge.wizard()).toMatchObject({
				locale: "de",
				step: "display",
				completed: false,
				profileIds: ["local"],
			});
			await f.bridge.saveWizard({ step: "runtime", runtime: "skipped" });
			const completed = await f.bridge.completeWizard();
			expect(completed).toMatchObject({
				completed: true,
				step: "complete",
				hardwareVerified: false,
			});
			expect(await f.bridge.completeWizard()).toEqual(completed);
			await f.locale.set("en");
			expect(await f.bridge.general()).toMatchObject({
				startHidden: true,
				launchAtLogin: false,
			});
			expect(await f.bridge.wizard()).toMatchObject({
				locale: "en",
				completed: true,
			});
			expect(f.nativeWrite).not.toHaveBeenCalled();
			expect(await f.bridge.replayWizard()).toMatchObject({
				step: "welcome",
				completed: false,
				profileIds: ["local"],
				runtime: "skipped",
			});
		} finally {
			await f.close();
		}
	});
	it("keeps saved login intent and the catalog denial distinct from confirmed OS state", async () => {
		const f = await setup();
		try {
			f.nativeWrite.mockImplementation(() =>
				Effect.fail(
					new SettingsOsApplyFailed(new Error("private-secret"), "denied"),
				),
			);
			await expect(
				f.bridge.saveGeneral({ launchAtLogin: true }),
			).rejects.toMatchObject({
				code: "QUAKE.SETTINGS.OS_APPLY_FAILED",
				reason: "denied",
			});
			expect(await f.bridge.general()).toMatchObject({ launchAtLogin: true });
			expect(await f.bridge.loginStatus()).toBe(false);
			const diagnostics = await f.diagnosticRecords();
			const records = diagnostics
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as Record<string, unknown>);
			const failed = records.find(
				(record) =>
					record.span_name === "GeneralSettingsService.save" &&
					record.outcome === "failure",
			);
			expect(failed).toMatchObject({
				trace_id: expect.stringMatching(/^[a-f0-9]{32}$/),
				span_id: expect.stringMatching(/^[a-f0-9]{16}$/),
				request_id: expect.any(String),
			});
			expect(JSON.stringify(failed)).toContain(
				"QUAKE.SETTINGS.OS_APPLY_FAILED",
			);
			expect(diagnostics).not.toContain("private-secret");
			await f.restart();
			expect(await f.bridge.general()).toMatchObject({ launchAtLogin: true });
			expect(
				await readFile(join(f.directory, "settings-v1.json"), "utf8"),
			).not.toContain("private-secret");
		} finally {
			await f.close();
		}
	});
	it("rejects panel, foreign/subframes and invalid payloads before native IO", async () => {
		const f = await setup();
		const message = {
			_tag: "Request",
			id: "1",
			tag: "settings.saveGeneral",
			payload: { preferences: { launchAtLogin: true } },
		};
		try {
			await expect(
				f.handler(SETTINGS_BACKEND_REQUEST)(f.panel.event(), message),
			).rejects.toThrow("QUAKE.SETTINGS.UNAUTHORIZED");
			await expect(
				f.handler(SETTINGS_BACKEND_REQUEST)(
					{
						...f.management.event(),
						senderFrame: { url: f.management.sender.mainFrame.url },
					} as IpcMainInvokeEvent,
					message,
				),
			).rejects.toThrow("QUAKE.SETTINGS.UNAUTHORIZED");
			await expect(
				f.handler(SETTINGS_BACKEND_REQUEST)(f.management.event(), {
					...message,
					payload: { preferences: { launchAtLogin: true, secret: "no" } },
				}),
			).rejects.toThrow("QUAKE.SETTINGS.UNAUTHORIZED");
			f.management.sender.mainFrame.url = "https://foreign.example";
			await expect(
				f.handler(SETTINGS_BACKEND_REQUEST)(f.management.event(), message),
			).rejects.toThrow("QUAKE.SETTINGS.UNAUTHORIZED");
			expect(f.nativeWrite).not.toHaveBeenCalled();
		} finally {
			await f.close();
		}
	});
	it("retains malformed settings on failed startup and removes both handlers on shutdown", async () => {
		const f = await setup();
		try {
			await f.bridge.general();
			await writeFile(
				join(f.directory, "settings-v1.json"),
				'{"version":99,"token":"keep-private"}',
			);
			await f.restart();
			await expect(f.bridge.general()).rejects.toBeDefined();
			expect(
				await readFile(join(f.directory, "settings-v1.json"), "utf8"),
			).toContain('"version":99');
		} finally {
			await f.close();
		}
		expect(ipc.removeHandler).toHaveBeenCalledWith(SETTINGS_BACKEND_REQUEST);
		expect(ipc.removeHandler).toHaveBeenCalledWith(LOCALE_REQUEST);
	});
});
