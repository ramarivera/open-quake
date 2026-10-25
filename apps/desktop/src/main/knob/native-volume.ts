import { type ChildProcess, execFile } from "node:child_process";
import { Effect, Schema } from "effect";
import {
	KnobCapabilityUnavailable,
	KnobDispatchFailed,
	type KnobError,
} from "../../../../../packages/device/src/knob/knob-errors.js";
import { VolumeReading } from "../../../../../packages/device/src/knob/model/contracts.js";

export type ScriptRunner = (source: string) => Effect.Effect<string, KnobError>;
/** Bounded process IO; interruption kills the child. No shell or foreground app. */
export const script: ScriptRunner = Effect.fn("DesktopKnob.nativeScript")(
	(source: string) =>
		Effect.async<string, KnobError>((resume) => {
			if (process.platform !== "darwin") {
				resume(Effect.fail(KnobCapabilityUnavailable.fromCause()));
				return;
			}
			let child: ChildProcess;
			try {
				child = execFile(
					"/usr/bin/osascript",
					["-e", source],
					{ timeout: 3000, maxBuffer: 4096 },
					(cause, stdout) => {
						resume(
							cause
								? Effect.fail(KnobDispatchFailed.fromCause(cause))
								: Effect.succeed(stdout.trim()),
						);
					},
				);
			} catch (cause) {
				resume(Effect.fail(KnobDispatchFailed.fromCause(cause)));
				return;
			}
			return Effect.sync(() => {
				child.kill();
			});
		}),
);

export const readNativeVolume = Effect.fn("DesktopKnob.readVolume")(
	(run: ScriptRunner = script): Effect.Effect<VolumeReading, KnobError> =>
		run("get {output volume, output muted} of (get volume settings)").pipe(
			Effect.flatMap((output) =>
				Effect.try({
					try: () => {
						const match = /^(\d{1,3}), (true|false)$/.exec(output);
						if (!match) throw new RangeError("Invalid native volume response");
						return Schema.decodeUnknownSync(VolumeReading)({
							level: Number(match[1]),
							muted: match[2] === "true",
						});
					},
					catch: (cause) => KnobDispatchFailed.fromCause(cause),
				}),
			),
		),
);
export const macVolume = readNativeVolume();
