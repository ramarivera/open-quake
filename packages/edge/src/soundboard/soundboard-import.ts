import { Effect } from "effect";
import type { SoundEntry, SoundImportPreview } from "./soundboard-contracts.js";
import {
	type SoundboardConfigInvalid,
	SoundboardFileUnavailable,
} from "./soundboard-errors.js";
import { classifyImport, importSoundConfig } from "./soundboard-invariants.js";
import { SoundboardFiles } from "./soundboard-ports.js";

export class SoundboardImporter extends Effect.Service<SoundboardImporter>()(
	"@open-quake/edge/SoundboardImporter",
	{
		accessors: true,
		effect: Effect.gen(function* () {
			const files = yield* SoundboardFiles;
			const preview = Effect.fn("SoundboardImporter.preview")(function* (
				raw: unknown,
			): Effect.fn.Return<SoundImportPreview, SoundboardConfigInvalid> {
				const parsed = yield* importSoundConfig(raw);
				const entries = yield* Effect.forEach(
					parsed.entries,
					(entry) => {
						if (entry.status === "invalidPath") return Effect.succeed(entry);
						return files.inspect(entry.path).pipe(
							Effect.timeoutFail({
								duration: "2 seconds",
								onTimeout: () => new SoundboardFileUnavailable(),
							}),
							Effect.tapError((error) =>
								Effect.logWarning("soundboard.file.inspection.failed", error),
							),
							Effect.catchTag("SoundboardFileUnavailable", () =>
								Effect.succeed("unreadable" as const),
							),
							Effect.map(
								(status): SoundEntry => ({
									...entry,
									status:
										status === "available" &&
										!entry.path.toLowerCase().endsWith(".mp3")
											? "notMp3"
											: status,
								}),
							),
						);
					},
					{ concurrency: 4 },
				);
				return classifyImport(entries, parsed);
			});
			return { preview };
		}),
	},
) {}
