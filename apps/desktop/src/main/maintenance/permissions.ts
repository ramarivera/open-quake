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
						result === true || result === "granted"
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
