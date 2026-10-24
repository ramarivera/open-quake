import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Effect, Schema } from "effect";
import { IconStorageFailed } from "./icon-errors";
import { type IconAsset, IconPack } from "./icon-packs";
export function iconStore(path: string) {
	let loaded: readonly IconPack[] | undefined;
	const read = Effect.fn("IconRepository.read")(function* (): Effect.fn.Return<
		readonly IconPack[],
		IconStorageFailed
	> {
		if (loaded) return loaded;
		const bytes = yield* Effect.tryPromise({
			try: async () => {
				try {
					return await readFile(path, "utf8");
				} catch (cause) {
					if (
						cause instanceof Error &&
						"code" in cause &&
						cause.code === "ENOENT"
					)
						return "[]";
					throw cause;
				}
			},
			catch: (cause) => new IconStorageFailed(cause),
		});
		const packs = yield* Effect.try({
			try: () =>
				Schema.decodeUnknownSync(Schema.Array(IconPack))(JSON.parse(bytes)),
			catch: (cause) => new IconStorageFailed(cause),
		});
		loaded = packs;
		return packs;
	});
	const write = Effect.fn("IconRepository.write")(function* (
		packs: readonly IconPack[],
	): Effect.fn.Return<void, IconStorageFailed> {
		yield* Effect.tryPromise({
			try: async () => {
				await mkdir(dirname(path), { recursive: true });
				const temp = `${path}.${randomUUID()}.tmp`;
				try {
					await writeFile(temp, JSON.stringify(packs), {
						mode: 0o600,
						flag: "wx",
					});
					await rename(temp, path);
				} finally {
					const { rm } = await import("node:fs/promises");
					await rm(temp, { force: true }).catch(() => {});
				}
			},
			catch: (cause) => new IconStorageFailed(cause),
		});
		loaded = packs;
	});
	const add = Effect.fn("IconRepository.add")(function* (
		pack: IconPack,
	): Effect.fn.Return<void, IconStorageFailed> {
		const packs = yield* read();
		if (!packs.some((p) => p.id === pack.id)) yield* write([...packs, pack]);
	});
	const addLocal = Effect.fn("IconRepository.addLocal")(function* (
		icon: IconAsset,
	): Effect.fn.Return<void, IconStorageFailed> {
		const packs = yield* read();
		const local = packs.find((p) => p.id === "local");
		if (local?.icons.some((i) => i.id === icon.id)) return;
		yield* write([
			...packs.filter((p) => p.id !== "local"),
			{
				id: "local",
				name: "Local App Icons",
				icons: [...(local?.icons ?? []), icon],
			},
		]);
	});
	return { read, write, add, addLocal };
}
