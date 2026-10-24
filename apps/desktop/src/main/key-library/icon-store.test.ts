import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either } from "effect";
import { expect, it } from "vitest";
import { IconImportFailed, IconStorageFailed } from "./icon-errors";
import { iconStore } from "./icon-store";

it("persists and deduplicates validated pack content across repository instances", async () => {
	const dir = await mkdtemp(join(tmpdir(), "key-library-test-"));
	try {
		const path = join(dir, "icons.json"),
			store = iconStore(path),
			pack = {
				id: "pack",
				name: "Pack",
				icons: [
					{
						id: "icon",
						name: "Icon",
						tags: [],
						data: "data:image/png;base64,AA==",
					},
				],
			};
		await Effect.runPromise(store.add(pack));
		await Effect.runPromise(store.add(pack));
		expect(await Effect.runPromise(iconStore(path).read())).toEqual([pack]);
		const failed = await Effect.runPromise(
			Effect.either(iconStore(dir).write([pack])),
		);
		expect(Either.isLeft(failed) && failed.left._tag).toBe("IconStorageFailed");
		expect(await Effect.runPromise(store.read())).toEqual([pack]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
it.each([IconImportFailed, IconStorageFailed])(
	"keeps boundary identity and private original cause",
	(ErrorType) => {
		const original = Object.assign(new Error("token=private-value"), {
				code: "EIO",
			}),
			error = new ErrorType(original);
		expect(error.originalCause).toBe(original);
		expect(error.code).toMatch(/^QUAKE.ICON\./);
		expect(JSON.stringify(error)).not.toContain("private-value");
	},
);
