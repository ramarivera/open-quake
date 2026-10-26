import { Effect } from "effect";
import { shell, systemPreferences } from "electron";
import type {
	PermissionKey,
	PermissionRow,
} from "../../../../../packages/edge/src/maintenance/contracts.js";
import { PermissionProbeFailed } from "../../../../../packages/edge/src/maintenance/maintenance-errors.js";
export const permissionLinks = {
	accessibility: "Accessibility",
	inputMonitoring: "ListenEvent",
	microphone: "Microphone",
	screenRecording: "ScreenCapture",
	systemAudio: "AudioCapture",
} as const;
export interface PermissionChecks {
	accessibility: () => unknown;
	inputMonitoring: () => unknown;
	microphone: () => unknown;
	screenRecording: () => unknown;
	systemAudio: () => unknown;
}
export function permissionRows(
	checks: PermissionChecks,
): readonly PermissionRow[] {
	return Object.keys(permissionLinks)
		.filter((key): key is PermissionKey => key in checks)
		.map((key) => {
			try {
				const result = checks[key]();
				return {
					key,
					status:
						result === "unsupported"
							? "unsupported"
							: result === true || result === "granted"
								? "granted"
								: result === false ||
										["denied", "restricted", "not-determined"].includes(
											String(result),
										)
									? "denied"
									: "unknown",
				};
			} catch {
				return { key, status: "unknown" };
			}
		});
}
/** Fixed paths/signatures only. No permission request, capture, or TCC registration on status reads. */
export async function nativePermissionChecks(): Promise<PermissionChecks> {
	let input: () => unknown = () => undefined;
	let audio: () => unknown = () => undefined;
	try {
		const koffi = await import("koffi");
		const core = koffi.load(
			"/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics",
		);
		const preflight = core.func("bool CGPreflightListenEventAccess(void)");
		input = () => preflight();
	} catch {
		/* Missing framework/symbol remains unknown. */
	}
	try {
		const koffi = await import("koffi");
		const cf = koffi.load(
			"/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation",
		);
		const tcc = koffi.load(
			"/System/Library/PrivateFrameworks/TCC.framework/TCC",
		);
		const create = cf.func(
			"void *CFStringCreateWithCString(void *alloc, const char *text, uint32_t encoding)",
		);
		const release = cf.func("void CFRelease(void *value)");
		const preflight = tcc.func(
			"int TCCAccessPreflight(void *service, void *options)",
		);
		audio = () => {
			const service = create(null, "kTCCServiceAudioCapture", 0x08000100);
			if (!service) return undefined;
			try {
				const status: unknown = preflight(service, null);
				return status === 0 ? true : status === 1 ? false : undefined;
			} finally {
				release(service);
			}
		};
	} catch {
		/* Private TCC API is optional; never infer a grant from probe registration. */
	}
	return {
		accessibility: () => systemPreferences.isTrustedAccessibilityClient(false),
		inputMonitoring: input,
		microphone: () => systemPreferences.getMediaAccessStatus("microphone"),
		screenRecording: () => systemPreferences.getMediaAccessStatus("screen"),
		systemAudio: audio,
	};
}
export const openPermission = (
	key: PermissionKey,
): Effect.Effect<void, PermissionProbeFailed> =>
	Effect.tryPromise({
		try: () =>
			shell.openExternal(
				`x-apple.systempreferences:com.apple.preference.security?Privacy_${permissionLinks[key]}`,
			),
		catch: (cause) => new PermissionProbeFailed(cause),
	});

export interface PermissionActionEdges {
	readonly checks: PermissionChecks;
	readonly request: (key: PermissionKey) => Promise<void>;
	readonly open: (key: PermissionKey) => Promise<void>;
}
/** Called only by the authorized permission mutation, never status polling/startup. */
export const permissionAction = (
	key: PermissionKey,
	edges: PermissionActionEdges,
): Effect.Effect<void, PermissionProbeFailed> =>
	Effect.tryPromise({
		try: async () => {
			const before = permissionRows(edges.checks).find(
				(row) => row.key === key,
			)?.status;
			if (before !== "granted") await edges.request(key);
			const after = permissionRows(edges.checks).find(
				(row) => row.key === key,
			)?.status;
			// A fresh microphone grant needs no second System Settings handoff.
			if (key !== "microphone" || before === "granted" || after !== "granted")
				await edges.open(key);
		},
		catch: (cause) => new PermissionProbeFailed(cause),
	});

/** Explicit user requests only. These APIs ask for access; they never record a microphone. */
export async function nativePermissionRequest(
	key: PermissionKey,
): Promise<void> {
	if (process.platform !== "darwin") return;
	switch (key) {
		case "accessibility":
			systemPreferences.isTrustedAccessibilityClient(true);
			return;
		case "microphone":
			await systemPreferences.askForMediaAccess("microphone");
			return;
		case "inputMonitoring":
		case "screenRecording": {
			const koffi = await import("koffi");
			const core = koffi.load(
				"/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics",
			);
			const request = core.func(
				key === "inputMonitoring"
					? "bool CGRequestListenEventAccess(void)"
					: "bool CGRequestScreenCaptureAccess(void)",
			);
			request();
			return;
		}
		case "systemAudio":
			// AudioCapture has no supported request-only API. Use the isolated,
			// short-lived loopback registration worker only after a user gesture.
			await registerSystemAudio();
	}
}

async function registerSystemAudio(): Promise<void> {
	const { BrowserWindow, desktopCapturer } = await import("electron");
	const worker = new BrowserWindow({
		show: false,
		focusable: false,
		skipTaskbar: true,
		width: 16,
		height: 16,
		webPreferences: {
			partition: `privacy-registration-${crypto.randomUUID()}`,
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	worker.webContents.setAudioMuted(true);
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			(async () => {
				worker.webContents.session.setDisplayMediaRequestHandler(
					(_request, respond) => {
						void desktopCapturer
							.getSources({
								types: ["screen"],
								thumbnailSize: { width: 0, height: 0 },
							})
							.then(
								(sources) => {
									if (!worker.isDestroyed() && sources[0])
										respond({ video: sources[0], audio: "loopback" });
									else respond({});
								},
								() => respond({}),
							);
					},
				);
				// getDisplayMedia requires a secure origin. This isolated session
				// serves the request page locally and never makes a network request.
				await worker.webContents.session.protocol.handle(
					"https",
					() =>
						new Response(
							"<meta charset=utf-8><title>open-quake permission request</title>",
							{
								headers: { "content-type": "text/html; charset=utf-8" },
							},
						),
				);
				await worker.loadURL("https://permission.open-quake.invalid/");
				if (worker.isDestroyed()) return;
				await worker.webContents.executeJavaScript(
					`(async () => {
                    const stream = await navigator.mediaDevices.getDisplayMedia({video:true,audio:true});
                    try { return true; } finally { for (const track of stream.getTracks()) track.stop(); }
                })()`,
					true,
				);
			})(),
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(
					() => reject(new Error("Permission registration deadline")),
					10000,
				);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
		worker.webContents.session.setDisplayMediaRequestHandler(null);
		worker.webContents.session.protocol.unhandle("https");
		if (!worker.isDestroyed()) worker.destroy();
	}
}
