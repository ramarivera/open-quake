import { execFile } from "node:child_process";
import { Effect } from "effect";
import { KnobDispatchFailed } from "../../../../../../packages/device/src/knob/knob-errors.js";

export type BrightnessProcess = (
	file: string,
	args: readonly string[],
) => Effect.Effect<string, KnobDispatchFailed>;
export const brightnessProcess: BrightnessProcess = Effect.fn(
	"DesktopBrightness.process",
)((file, args) =>
	Effect.tryPromise({
		try: (signal) =>
			new Promise<string>((resolve, reject) => {
				execFile(
					file,
					args,
					{
						timeout: 5000,
						killSignal: "SIGKILL",
						maxBuffer: 4096,
						windowsHide: true,
						signal,
					},
					(error, stdout) => (error ? reject(error) : resolve(stdout.trim())),
				);
			}),
		catch: KnobDispatchFailed.fromCause,
	}),
);
