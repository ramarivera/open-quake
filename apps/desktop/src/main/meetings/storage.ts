import {
	lstat,
	readdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { MeetingStore } from "../../../../../packages/edge/src/meetings/meeting-contracts";
import { meetingError } from "../../../../../packages/edge/src/meetings/meeting-errors";
import type { MeetingStorage } from "../../../../../packages/edge/src/meetings/meeting-repository";
import { privateDirectory, privateOutput } from "./private-files";

const missing = (cause: unknown): boolean =>
	cause instanceof Error && "code" in cause && cause.code === "ENOENT";
export const meetingStorage = (root: string): MeetingStorage => {
	const trash = join(root, ".deleting");
	const validateId = (id: string) => Schema.decodeUnknownSync(Schema.UUID)(id);
	const save = async (store: typeof MeetingStore.Encoded): Promise<void> => {
		await privateDirectory(root);
		const staging = join(root, "history.staging.json");
		// Refuse stale symlinks and repair existing file permissions before writing.
		await privateOutput(staging);
		await writeFile(staging, JSON.stringify(store), { mode: 0o600 });
		await rename(staging, join(root, "history.json"));
	};
	const restore = async (ids: readonly string[]): Promise<void> => {
		const results = await Promise.allSettled(
			ids.map((id) => rename(join(trash, id), join(root, id))),
		);
		const failed = results.find((result) => result.status === "rejected");
		if (failed?.status === "rejected") throw failed.reason;
	};
	return {
		load: () =>
			Effect.tryPromise({
				try: async () => {
					await privateDirectory(root);
					const text = await readFile(join(root, "history.json"), "utf8").catch(
						(cause: unknown) => {
							if (missing(cause)) return '{"version":1,"records":[]}';
							throw cause;
						},
					);
					const store: unknown = JSON.parse(text);
					const decoded = Schema.decodeUnknownSync(MeetingStore)(store);
					await privateDirectory(trash);
					for (const id of await readdir(trash)) {
						validateId(id);
						if (decoded.records.some((record) => record.id === id))
							await restore([id]);
						else await rm(join(trash, id), { recursive: true, force: true });
					}
					return store;
				},
				catch: (cause) => meetingError("StorageFailed", cause),
			}),
		save: (store) =>
			Effect.tryPromise({
				try: () => save(store),
				catch: (cause) => meetingError("StorageFailed", cause),
			}),
		remove: (store, ids) =>
			Effect.tryPromise({
				try: async () => {
					await privateDirectory(root);
					await privateDirectory(trash);
					const staged: string[] = [];
					try {
						for (const id of ids) {
							validateId(id);
							const source = join(root, id);
							const info = await lstat(source).catch((cause: unknown) => {
								if (missing(cause)) return undefined;
								throw cause;
							});
							if (!info) continue;
							if (!info.isDirectory())
								throw new Error("Invalid meeting directory");
							await rename(source, join(trash, id));
							staged.push(id);
						}
						await save(store);
					} catch (cause) {
						await restore(staged);
						throw cause;
					}
					// The history transition is committed. Deferred cleanup is retried on load.
					await Promise.allSettled(
						staged.map((id) =>
							rm(join(trash, id), { recursive: true, force: true }),
						),
					);
				},
				catch: (cause) => meetingError("StorageFailed", cause),
			}),
		deleteAudio: (ids) =>
			Effect.tryPromise({
				try: async () => {
					for (const id of ids) {
						validateId(id);
						await rm(join(root, id), { recursive: true, force: true });
					}
				},
				catch: (cause) => meetingError("StorageFailed", cause),
			}),
	};
};
