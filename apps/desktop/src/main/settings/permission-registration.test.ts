import { afterEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => {
	const worker = {
		webContents: {
			setAudioMuted: vi.fn(),
			session: {
				setDisplayMediaRequestHandler: vi.fn(),
				protocol: { handle: vi.fn(async () => {}), unhandle: vi.fn() },
			},
			executeJavaScript: vi.fn(
				async (_script: string, _gesture: boolean) => true,
			),
		},
		loadURL: vi.fn(async () => {}),
		isDestroyed: vi.fn(() => false),
		destroy: vi.fn(),
	};
	return {
		worker,
		systemPreferences: {
			isTrustedAccessibilityClient: vi.fn(() => false),
			askForMediaAccess: vi.fn(async () => true),
		},
		desktopCapturer: { getSources: vi.fn(async () => []) },
		coreRequest: vi.fn(() => true),
		coreSymbol: vi.fn(),
	};
});
vi.mock("electron", () => ({
	...native,
	BrowserWindow: class {
		webContents = native.worker.webContents;
		loadURL = native.worker.loadURL;
		isDestroyed = native.worker.isDestroyed;
		destroy = native.worker.destroy;
	},
	shell: {},
}));

vi.mock("koffi", () => ({
	load: () => ({
		func: () => {
			native.coreSymbol();
			return native.coreRequest;
		},
	}),
}));

import {
	nativePermissionRequest,
	permissionAction,
	permissionRows,
} from "../maintenance/permissions";

afterEach(() => vi.clearAllMocks());
it("SETTINGS-015 status reads don't request access; explicit Accessibility and microphone actions request without recording", async () => {
	permissionRows({
		accessibility: () => false,
		inputMonitoring: () => false,
		microphone: () => false,
		screenRecording: () => false,
		systemAudio: () => false,
	});
	expect(
		native.systemPreferences.isTrustedAccessibilityClient,
	).not.toHaveBeenCalled();
	if (process.platform !== "darwin") return;
	await nativePermissionRequest("accessibility");
	await nativePermissionRequest("microphone");
	expect(
		native.systemPreferences.isTrustedAccessibilityClient,
	).toHaveBeenCalledExactlyOnceWith(true);
	expect(
		native.systemPreferences.askForMediaAccess,
	).toHaveBeenCalledExactlyOnceWith("microphone");
	expect(native.worker.loadURL).not.toHaveBeenCalled();
});
it("SETTINGS-015 isolates and destroys the muted System Audio registration worker on success or failure", async () => {
	if (process.platform !== "darwin") return;
	await nativePermissionRequest("systemAudio");
	expect(
		native.worker.webContents.setAudioMuted,
	).toHaveBeenCalledExactlyOnceWith(true);
	expect(
		native.worker.webContents.executeJavaScript.mock.calls[0]?.[0],
	).toContain("track.stop()");
	expect(native.worker.destroy).toHaveBeenCalledOnce();
	expect(
		native.worker.webContents.session.setDisplayMediaRequestHandler,
	).toHaveBeenLastCalledWith(null);
	expect(
		native.worker.webContents.session.protocol.unhandle,
	).toHaveBeenCalledWith("https");
	native.worker.webContents.executeJavaScript.mockRejectedValueOnce(
		new Error("denied"),
	);
	await expect(nativePermissionRequest("systemAudio")).rejects.toThrow(
		"denied",
	);
	expect(native.worker.destroy).toHaveBeenCalledTimes(2);
});

it("SETTINGS-015 requests Input Monitoring and Screen Recording only through mocked native functions", async () => {
	if (process.platform !== "darwin") return;
	await nativePermissionRequest("inputMonitoring");
	await nativePermissionRequest("screenRecording");
	expect(native.coreRequest).toHaveBeenCalledTimes(2);
	expect(native.worker.loadURL).not.toHaveBeenCalled();
});
it("SETTINGS-015 destroys a stalled permission worker at its ten-second deadline", async () => {
	if (process.platform !== "darwin") return;
	vi.useFakeTimers();
	try {
		native.worker.webContents.executeJavaScript.mockImplementationOnce(
			() => new Promise(() => {}),
		);
		const result = expect(
			nativePermissionRequest("systemAudio"),
		).rejects.toThrow("Permission registration deadline");
		await vi.advanceTimersByTimeAsync(10000);
		await result;
		expect(native.worker.destroy).toHaveBeenCalledOnce();
		expect(
			native.worker.webContents.session.setDisplayMediaRequestHandler,
		).toHaveBeenLastCalledWith(null);
		expect(
			native.worker.webContents.session.protocol.unhandle,
		).toHaveBeenCalledWith("https");
	} finally {
		vi.useRealTimers();
	}
});

it.each(["inputMonitoring", "screenRecording"] as const)(
	"SETTINGS-015 unavailable %s request API still hands off to Settings",
	async (key) => {
		if (process.platform !== "darwin") return;
		const { Effect } = await import("effect");
		const cause = new Error("synthetic missing native symbol");
		native.coreSymbol.mockImplementationOnce(() => {
			throw cause;
		});
		const open = vi.fn(async () => {});
		const checks = {
			accessibility: () => false,
			inputMonitoring: () => undefined,
			microphone: () => false,
			screenRecording: () => undefined,
			systemAudio: () => undefined,
		};
		const result = await Effect.runPromise(
			Effect.either(
				permissionAction(key, {
					checks,
					request: nativePermissionRequest,
					open,
				}),
			),
		);
		expect(open).toHaveBeenCalledExactlyOnceWith(key);
		expect(native.coreRequest).not.toHaveBeenCalled();
		expect(result._tag).toBe("Left");
		if (result._tag === "Left") {
			expect(result.left.originalCause).toBe(cause);
			expect(result.left.code).toBe("QUAKE.SETTINGS.PERMISSION_PROBE_FAILED");
		}
	},
);
