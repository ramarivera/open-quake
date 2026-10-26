import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { Effect, Layer } from "effect";
import { SoundboardFileUnavailable } from "../../../../../packages/edge/src/soundboard/soundboard-errors.js";
import { isLocalSoundPath } from "../../../../../packages/edge/src/soundboard/soundboard-invariants.js";
import {
	SoundboardFiles,
	type SoundFileAvailability,
} from "../../../../../packages/edge/src/soundboard/soundboard-ports.js";

/** Read-only metadata probe. Construction never touches a file or acquires audio output. */
export const SoundboardFilesLive = Layer.succeed(SoundboardFiles, {
	inspect: Effect.fn("SoundboardFiles.inspect")(
		(
			path: string,
		): Effect.Effect<SoundFileAvailability, SoundboardFileUnavailable> => {
			if (
				!isLocalSoundPath(path) ||
				!isAbsolute(path) ||
				(process.platform === "win32" && !/^[a-zA-Z]:[\\/]/.test(path))
			)
				return Effect.fail(new SoundboardFileUnavailable());
			return Effect.tryPromise({
				try: async (): Promise<SoundFileAvailability> => {
					const entry = await stat(path);
					if (entry.isDirectory()) return "directory";
					if (!entry.isFile()) return "notFile";
					await access(path, constants.R_OK);
					return "available";
				},
				catch: (cause) => new SoundboardFileUnavailable(cause),
			}).pipe(
				Effect.catchTag("SoundboardFileUnavailable", (error) => {
					const cause = error.originalCause;
					return cause instanceof Error &&
						"code" in cause &&
						cause.code === "ENOENT"
						? Effect.succeed("missing" as const)
						: Effect.fail(error);
				}),
			);
		},
	),
});
