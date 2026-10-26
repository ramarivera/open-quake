import { type ChildProcess, execFile } from "node:child_process";
import { Effect } from "effect";
import { MediaProcessFailed } from "./errors";

export type MediaProcess = (
	file: string,
	args: readonly string[],
	values?: Readonly<Record<string, string>>,
) => Effect.Effect<string, MediaProcessFailed>;

/** Bounded one-shot children. Interruption awaits close; output never enters logs. */
export const mediaProcess: MediaProcess = Effect.fn(
	"SystemMedia.nativeProcess",
)((file, args, values) =>
	Effect.async<string, MediaProcessFailed>((resume) => {
		const env: NodeJS.ProcessEnv = {};
		for (const key of [
			"PATH",
			"HOME",
			"TMPDIR",
			"SystemRoot",
			"WINDIR",
			"TEMP",
			"TMP",
		])
			if (process.env[key]) env[key] = process.env[key];
		let child: ChildProcess;
		try {
			child = execFile(
				file,
				args,
				{
					timeout: 5000,
					killSignal: "SIGKILL",
					maxBuffer: 4 * 1024 * 1024,
					windowsHide: true,
					env: { ...env, ...values },
				},
				(error, stdout) =>
					resume(
						error
							? Effect.fail(MediaProcessFailed.fromCause(error))
							: Effect.succeed(stdout.trim()),
					),
			);
		} catch (cause) {
			resume(Effect.fail(MediaProcessFailed.fromCause(cause)));
			return;
		}
		let didClose = false;
		child.once("close", () => {
			didClose = true;
		});
		return Effect.async<void>((closed) => {
			if (didClose) {
				closed(Effect.void);
				return;
			}
			child.once("close", () => closed(Effect.void));
			child.kill("SIGKILL");
		});
	}),
);
