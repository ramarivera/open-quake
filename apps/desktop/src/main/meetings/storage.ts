import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { meetingError } from "../../../../../packages/edge/src/meetings/meeting-errors";
import type { MeetingStorage } from "../../../../../packages/edge/src/meetings/meeting-repository";

export const meetingStorage = (root: string): MeetingStorage => ({
	load: () =>
		Effect.tryPromise({
			try: async () => {
				await mkdir(root, { recursive: true, mode: 0o700 });
				const text = await readFile(join(root, "history.json"), "utf8").catch(
					(cause: unknown) => {
						if (
							cause instanceof Error &&
							"code" in cause &&
							cause.code === "ENOENT"
						)
							return '{"version":1,"records":[]}';
						throw cause;
					},
				);
				return JSON.parse(text);
			},
			catch: (cause) => meetingError("StorageFailed", cause),
		}),
	save: (store) =>
		Effect.tryPromise({
			try: async () => {
				await mkdir(root, { recursive: true, mode: 0o700 });
				const staging = join(root, "history.staging.json");
				await writeFile(staging, JSON.stringify(store), { mode: 0o600 });
				await rename(staging, join(root, "history.json"));
			},
			catch: (cause) => meetingError("StorageFailed", cause),
		}),
	deleteAudio: (ids) =>
		Effect.tryPromise({
			try: async () => {
				for (const id of ids)
					await rm(join(root, id), { recursive: true, force: true });
			},
			catch: (cause) => meetingError("StorageFailed", cause),
		}),
});
