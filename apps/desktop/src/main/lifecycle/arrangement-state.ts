import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Effect, Schema } from "effect";
import { DisplayOperationFailed } from "./native-display";

const Saved = Schema.parseJson(
	Schema.Struct({
		version: Schema.Literal(1),
		consented: Schema.Literal(true),
		applied: Schema.Literal(true),
	}),
);
/** Successful consented repair is the only writer of the first-run marker. */
export function arrangementState(path: string) {
	return {
		read: Effect.fn("ArrangementState.read")(() =>
			Effect.tryPromise({
				try: async () => {
					let text: string;
					try {
						text = await readFile(path, "utf8");
					} catch (cause) {
						if (
							typeof cause === "object" &&
							cause !== null &&
							"code" in cause &&
							cause.code === "ENOENT"
						)
							return false;
						throw cause;
					}
					Schema.decodeUnknownSync(Saved)(text);
					return true;
				},
				catch: (cause) => new DisplayOperationFailed(cause),
			}),
		),
		save: Effect.fn("ArrangementState.save")(() =>
			Effect.tryPromise({
				try: async () => {
					await mkdir(dirname(path), { recursive: true });
					await writeFile(
						path,
						Schema.encodeSync(Saved)({
							version: 1,
							consented: true,
							applied: true,
						}),
						{ mode: 0o600 },
					);
				},
				catch: (cause) => new DisplayOperationFailed(cause),
			}),
		),
	};
}
