import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Effect, Schema } from "effect";
import {
	APP_LIBRARY_MAX_BYTES,
	AppLibraryGroups,
	AppLibrarySnapshot,
	mergeMissingDefaultAppMenu,
} from "../../../../../packages/device/src/profiles/app-library.js";
import {
	AppLibrarySizeLimitExceeded,
	ProfileReadFailed,
	ProfileRevisionConflict,
	ProfileWriteFailed,
} from "../../../../../packages/device/src/profiles/profile-errors.js";

/** Called under the existing key-library request semaphore. Cache changes only after rename. */
export function appLibraryStore(path: string) {
	let cached: AppLibrarySnapshot | undefined;
	const write = (value: AppLibrarySnapshot) =>
		Effect.gen(function* () {
			const encoded = yield* Effect.try({
				try: () => JSON.stringify(Schema.encodeSync(AppLibrarySnapshot)(value)),
				catch: (cause) => ProfileWriteFailed.fromCause(cause),
			});
			if (Buffer.byteLength(encoded, "utf8") > APP_LIBRARY_MAX_BYTES)
				return yield* Effect.fail(
					AppLibrarySizeLimitExceeded.fromCause({
						operation: "app-library.write",
					}),
				);
			yield* Effect.tryPromise({
				try: async () => {
					await mkdir(dirname(path), { recursive: true });
					const temp = `${path}.${randomUUID()}.tmp`;
					try {
						await writeFile(temp, encoded, { mode: 0o600, flag: "wx" });
						await rename(temp, path);
						cached = value;
					} finally {
						await rm(temp, { force: true });
					}
				},
				catch: (cause) => ProfileWriteFailed.fromCause(cause),
			});
		});
	const read = Effect.fn("AppLibrary.read")(function* () {
		if (cached) return cached;
		const value = yield* Effect.tryPromise({
			try: async () => {
				try {
					const bytes = await readFile(path);
					if (bytes.byteLength > APP_LIBRARY_MAX_BYTES)
						throw new Error("App library exceeds size limit");
					return Schema.decodeUnknownSync(AppLibrarySnapshot)(
						JSON.parse(bytes.toString("utf8")),
					);
				} catch (cause) {
					if (
						cause instanceof Error &&
						"code" in cause &&
						cause.code === "ENOENT"
					)
						return { version: 1 as const, revision: 0, groups: [] };
					throw cause;
				}
			},
			catch: (cause) => ProfileReadFailed.fromCause(cause),
		});
		const groups = mergeMissingDefaultAppMenu(value.groups);
		const next =
			groups === value.groups
				? value
				: { ...value, groups, revision: value.revision + 1 };
		if (next !== value) yield* write(next);
		cached = next;
		return next;
	});
	const save = Effect.fn("AppLibrary.save")(function* (
		revision: number,
		input: unknown,
	) {
		const old = yield* read();
		if (old.revision !== revision)
			return yield* Effect.fail(
				ProfileRevisionConflict.forRevisions(revision, old.revision),
			);
		const groups = yield* Effect.try({
			try: () => Schema.decodeUnknownSync(AppLibraryGroups)(input),
			catch: (cause) => ProfileWriteFailed.fromCause(cause),
		});
		const next = {
			...old,
			revision: old.revision + 1,
			groups: mergeMissingDefaultAppMenu(groups),
		};
		yield* write(next);
		return next;
	});
	return { read, save };
}
