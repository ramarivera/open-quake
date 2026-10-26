import { execFile } from "node:child_process";
import { toSafeDiagnosticCause } from "@open-quake/device";
import { Effect, Schema } from "effect";
import type { Display } from "electron";

export const DisplayErrors = {
	OperationFailed: {
		code: "DESKTOP.DISPLAY.OPERATION_FAILED",
		category: "dependency",
		message: "The display operation could not be completed",
		policy: { userFacing: false, userRecoverable: true, retry: "manual" },
	},
} as const;
const definition = DisplayErrors.OperationFailed;
export class DisplayOperationFailed extends Schema.TaggedError<DisplayOperationFailed>()(
	"DisplayOperationFailed",
	{
		code: Schema.Literal(definition.code),
		category: Schema.Literal(definition.category),
		message: Schema.Literal(definition.message),
	},
) {
	declare readonly originalCause: unknown;
	readonly diagnosticCause;
	constructor(cause: unknown) {
		super(definition);
		this.diagnosticCause = toSafeDiagnosticCause(cause);
		Object.defineProperty(this, "originalCause", {
			value: cause,
			enumerable: false,
		});
	}
}

export interface DisplayOrigin {
	readonly id: number;
	readonly x: number;
	readonly y: number;
}
export function farRightOrigins(
	displays: readonly Display[],
	strip: Display,
	primaryId: number,
): readonly DisplayOrigin[] {
	const others = displays.filter((d) => d.id !== strip.id);
	if (!others.length) return [];
	const primary = others.find((d) => d.id === primaryId) ?? others[0];
	if (!primary) return [];
	const dx = primaryId === strip.id ? -primary.bounds.x : 0;
	const dy = primaryId === strip.id ? -primary.bounds.y : 0;
	const right = Math.max(
		...others.map((d) => d.bounds.x + dx + d.bounds.width),
	);
	return [
		...others.map((d) => ({
			id: d.id,
			x: Math.round(d.bounds.x + dx),
			y: Math.round(d.bounds.y + dy),
		})),
		{ id: strip.id, x: Math.round(right), y: 0 },
	];
}

/** Fixed JXA program. Only numeric IDs/origins cross stdin via argv; no shell. */
export const CORE_GRAPHICS_PROGRAM = `
ObjC.import('CoreGraphics');
ObjC.bindFunction('CGDisplayIsInMirrorSet', ['bool', ['unsigned int']]);
ObjC.bindFunction('CGBeginDisplayConfiguration', ['int', ['void **']]);
ObjC.bindFunction('CGConfigureDisplayOrigin', ['int', ['void *', 'unsigned int', 'int', 'int']]);
ObjC.bindFunction('CGConfigureDisplayMirrorOfDisplay', ['int', ['void *', 'unsigned int', 'unsigned int']]);
ObjC.bindFunction('CGCompleteDisplayConfiguration', ['int', ['void *', 'int']]);
ObjC.bindFunction('CGCancelDisplayConfiguration', ['int', ['void *']]);
function run(args) {
  var action = args[0], id = Number(args[1]);
  if (action === 'probe') return $.CGDisplayIsInMirrorSet(id) ? 'mirrored' : 'extended';
  if (action !== 'fix') throw Error('Unknown display action');
  var origins = JSON.parse(args[2]), config = Ref();
  if ($.CGBeginDisplayConfiguration(config) !== 0) throw Error('Cannot begin display configuration');
  var committed = false;
  try {
    if ($.CGConfigureDisplayMirrorOfDisplay(config[0], id, 0) !== 0) throw Error('Cannot extend display');
    origins.forEach(function(origin) {
      if ($.CGConfigureDisplayOrigin(config[0], origin.id, origin.x, origin.y) !== 0) throw Error('Cannot move display');
    });
    if ($.CGCompleteDisplayConfiguration(config[0], 1) !== 0) throw Error('Cannot commit display configuration');
    committed = true;
    return 'applied';
  } finally { if (!committed) $.CGCancelDisplayConfiguration(config[0]); }
}`;

export const callDisplayTool = Effect.fn("NativeDisplay.call")(
	(
		action: "probe" | "fix",
		id: number,
		origins: readonly DisplayOrigin[] = [],
	): Effect.Effect<string, DisplayOperationFailed> =>
		Effect.tryPromise({
			try: (signal) =>
				new Promise<string>((resolve, reject) => {
					execFile(
						"/usr/bin/osascript",
						[
							"-l",
							"JavaScript",
							"-e",
							CORE_GRAPHICS_PROGRAM,
							action,
							String(id),
							JSON.stringify(origins),
						],
						{ timeout: 10_000, maxBuffer: 16_384, signal },
						(error, stdout) => (error ? reject(error) : resolve(stdout.trim())),
					);
				}),
			catch: (cause) => new DisplayOperationFailed(cause),
		}),
);

/** system_profiler can see a mirrored strip that Electron omits on first launch. */
export function hasHiddenQuakeMirror(input: unknown, depth = 0): boolean {
	if (depth > 8 || input === null || typeof input !== "object") return false;
	if (Array.isArray(input))
		return input.some((value: unknown) =>
			hasHiddenQuakeMirror(value, depth + 1),
		);
	if (
		"_name" in input &&
		typeof input._name === "string" &&
		input._name.toUpperCase().includes("DK-QUAKE") &&
		"spdisplays_mirror" in input &&
		input.spdisplays_mirror === "spdisplays_on"
	)
		return true;
	return Object.values(input).some((value: unknown) =>
		hasHiddenQuakeMirror(value, depth + 1),
	);
}
export const probeHiddenMirroring = Effect.fn("NativeDisplay.hiddenMirroring")(
	(): Effect.Effect<boolean, DisplayOperationFailed> =>
		Effect.tryPromise({
			try: (signal) =>
				new Promise<boolean>((resolve, reject) => {
					execFile(
						"/usr/sbin/system_profiler",
						["SPDisplaysDataType", "-json"],
						{ timeout: 10_000, maxBuffer: 1_048_576, signal },
						(error, stdout) => {
							if (error) {
								reject(error);
								return;
							}
							try {
								const data: unknown = JSON.parse(stdout);
								resolve(hasHiddenQuakeMirror(data));
							} catch (cause) {
								reject(cause);
							}
						},
					);
				}),
			catch: (cause) => new DisplayOperationFailed(cause),
		}),
);

export const WINDOWS_DISPLAY_PROBE = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$screens = @([System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
  @{ width = $_.Bounds.Width; height = $_.Bounds.Height }
})
$names = @(Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorID | ForEach-Object {
  -join ($_.UserFriendlyName | Where-Object { $_ -ne 0 } | ForEach-Object { [char]$_ })
})
@{ screens = $screens; names = $names } | ConvertTo-Json -Compress -Depth 4
`;
const WindowsProbe = Schema.Struct({
	screens: Schema.Array(
		Schema.Struct({ width: Schema.Number, height: Schema.Number }),
	),
	names: Schema.Array(Schema.String),
});
export type NativeTool = (
	file: string,
	args: readonly string[],
) => Effect.Effect<string, DisplayOperationFailed>;
export const runNativeTool: NativeTool = Effect.fn("NativeDisplay.runTool")(
	(file, args) =>
		Effect.tryPromise({
			try: (signal) =>
				new Promise<string>((resolve, reject) =>
					execFile(
						file,
						[...args],
						{ signal, timeout: 8000, windowsHide: true, maxBuffer: 1_048_576 },
						(error, stdout) => (error ? reject(error) : resolve(stdout.trim())),
					),
				),
			catch: (cause) => new DisplayOperationFailed(cause),
		}),
);
export const probeWindowsDisplays = Effect.fn("NativeDisplay.windowsProbe")(
	function* (run: NativeTool = runNativeTool) {
		const raw = yield* run("powershell.exe", [
			"-NoLogo",
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			WINDOWS_DISPLAY_PROBE,
		]);
		const probe = yield* Effect.try({
			try: () => Schema.decodeUnknownSync(Schema.parseJson(WindowsProbe))(raw),
			catch: (cause) => new DisplayOperationFailed(cause),
		});
		const screen = probe.screens.find((d) =>
			[
				[1920, 480],
				[480, 1920],
			].some(
				([w = 0, h = 0]) =>
					Math.abs(d.width - w) < 10 && Math.abs(d.height - h) < 10,
			),
		);
		const named = probe.names.some((name) =>
			name.trim().toUpperCase().includes("DK-QUAKE"),
		);
		return {
			source: named
				? ("wmi-name" as const)
				: screen
					? ("forms-size" as const)
					: ("none" as const),
			present: named || !!screen,
			width: screen?.width ?? 0,
			height: screen?.height ?? 0,
			failed: false,
		};
	},
);
export const extendWindowsDisplays = Effect.fn("NativeDisplay.windowsExtend")(
	(run: NativeTool = runNativeTool) =>
		run("DisplaySwitch.exe", ["/extend"]).pipe(Effect.asVoid),
);
