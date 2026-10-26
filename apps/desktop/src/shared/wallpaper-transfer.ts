import { Schema } from "effect";
import { WallpaperSnapshot } from "./wallpaper-contracts";

type Asset = WallpaperSnapshot["asset"];
type Ready = Extract<Asset, { _tag: "ready" }>;
const TransferAsset = Schema.Union(
	WallpaperSnapshot.fields.asset,
	Schema.TaggedStruct("cached", { key: Schema.String }),
);
const Transfer = Schema.Struct({
	...WallpaperSnapshot.fields,
	asset: TransferAsset,
	preload: Schema.optional(
		Schema.Struct({
			index: Schema.Int.pipe(Schema.nonNegative()),
			asset: TransferAsset,
		}),
	),
});
type TransferAsset = typeof TransferAsset.Type;
const keyFor = (
	snapshot: WallpaperSnapshot | typeof Transfer.Type,
	index: number,
): string =>
	JSON.stringify([
		snapshot.saved.serial,
		snapshot.saved.settings.displayMediaList[index]?.filePath ?? index,
	]);

/** Each destination retains only its current and preloaded content, never a whole playlist. */
export class WallpaperSender {
	private assets = new Map<string, Ready>();
	clear() {
		this.assets.clear();
	}
	encode(snapshot: WallpaperSnapshot): typeof Transfer.Type {
		const next = new Map<string, Ready>();
		const asset = (value: Asset, index: number): TransferAsset => {
			if (value._tag !== "ready") return value;
			const key = keyFor(snapshot, index);
			next.set(key, value);
			const prior = this.assets.get(key);
			return prior?.dataUrl === value.dataUrl &&
				prior.width === value.width &&
				prior.height === value.height
				? { _tag: "cached", key }
				: value;
		};
		const encoded = {
			...snapshot,
			asset: asset(snapshot.asset, snapshot.activeIndex ?? 0),
			...(snapshot.preload
				? {
						preload: {
							index: snapshot.preload.index,
							asset: asset(snapshot.preload.asset, snapshot.preload.index),
						},
					}
				: {}),
		};
		this.assets = next;
		return encoded;
	}
}
export class WallpaperReceiver {
	private assets = new Map<string, Ready>();
	decode(input: unknown): WallpaperSnapshot | undefined {
		if (!Schema.is(Transfer)(input)) return undefined;
		const next = new Map<string, Ready>();
		const asset = (value: TransferAsset, index: number): Asset | undefined => {
			const key = keyFor(input, index);
			const ready =
				value._tag === "cached"
					? value.key === key
						? this.assets.get(key)
						: undefined
					: value;
			if (ready?._tag === "ready") next.set(key, ready);
			return ready;
		};
		const active = asset(input.asset, input.activeIndex ?? 0);
		const preload = input.preload
			? asset(input.preload.asset, input.preload.index)
			: undefined;
		if (!active || (input.preload && !preload)) return undefined;
		this.assets = next;
		const { preload: loading, ...base } = input;
		return {
			...base,
			asset: active,
			...(loading && preload
				? { preload: { index: loading.index, asset: preload } }
				: {}),
		};
	}
}
