import type { EmojiBridge } from "../../../../shared/emoji";

/** Immutable hashes deduplicate visible consumers; bound retained data URL memory. */
export function createEmojiAssetCache(
	request: EmojiBridge["request"],
	budget = 32 * 1024 * 1024,
) {
	const sources = new Map<string, string>();
	const pending = new Map<string, Promise<string>>();
	let size = 0;
	const load = (hash: string): Promise<string> => {
		if (!hash) return Promise.resolve("");
		const cached = sources.get(hash);
		if (cached !== undefined) {
			sources.delete(hash);
			sources.set(hash, cached);
			return Promise.resolve(cached);
		}
		const active = pending.get(hash);
		if (active) return active;
		const next = Promise.resolve()
			.then(() => request({ type: "asset", hash }))
			.then((reply) => {
				const source = reply._tag === "ready" ? (reply.assets[hash] ?? "") : "";
				const cost = source.length * 2;
				if (source && cost <= budget) {
					while (size + cost > budget) {
						const oldest = sources.entries().next().value;
						if (!oldest) break;
						sources.delete(oldest[0]);
						size -= oldest[1].length * 2;
					}
					sources.set(hash, source);
					size += cost;
				}
				return source;
			})
			.finally(() => pending.delete(hash));
		pending.set(hash, next);
		return next;
	};
	return { load };
}
