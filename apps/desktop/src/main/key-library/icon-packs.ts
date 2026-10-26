import { createHash } from "node:crypto";
import { Schema } from "effect";
import { safeIconSvg } from "./icon-svg";

export { safeIconSvg } from "./icon-svg";

import { readIconZip } from "./zip";

export const IconAsset = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	tags: Schema.Array(Schema.String),
	extraData: Schema.optional(Schema.Array(Schema.String)),
	data: Schema.String,
});
export type IconAsset = typeof IconAsset.Type;
export const IconPack = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	icons: Schema.Array(IconAsset),
});
export type IconPack = typeof IconPack.Type;
const hash = (bytes: Uint8Array | string): string =>
	createHash("sha256").update(bytes).digest("hex");
const invalid = (): never => {
	throw new Error("Invalid icon pack");
};
export const svgData = (svg: string): string =>
	`data:image/svg+xml;base64,${Buffer.from(safeIconSvg(svg)).toString("base64")}`;
export async function parseIconPack(
	bytes: Buffer,
	image: (bytes: Buffer) => string,
	renderFont?: (
		font: Buffer,
		glyphs: readonly { name: string; font_class: string; unicode: string }[],
	) => Promise<readonly IconAsset[]>,
): Promise<IconPack> {
	const raw = readIconZip(bytes);
	// A single enclosing directory is common in exported icon packs.
	const manifestPath = [...raw.keys()].find((p) =>
		/(^|\/)(manifest|iconfont)\.json$/.test(p),
	);
	if (!manifestPath) return invalid();
	const prefix = manifestPath.slice(0, manifestPath.lastIndexOf("/") + 1);
	const read = (name: string): Buffer => raw.get(prefix + name) ?? invalid();
	const json = (name: string): unknown =>
		JSON.parse(read(name).toString("utf8"));
	const decodeAsset = (path: string): string => {
		if (
			path.startsWith("/") ||
			path.split("/").some((p) => p === ".." || p === ".") ||
			path.includes("\\")
		)
			return invalid();
		const data = read(path);
		return /\.svg$/i.test(path)
			? svgData(data.toString("utf8").replace(/^\s*<\?xml[^>]*>\s*/, ""))
			: image(data);
	};
	let name: string, icons: IconAsset[];
	if (manifestPath.endsWith("manifest.json")) {
		const manifest = Schema.decodeUnknownSync(
			Schema.Struct({ Name: Schema.String }),
		)(json("manifest.json"));
		name = manifest.Name;
		const entries = Schema.decodeUnknownSync(
			Schema.Array(
				Schema.Struct({
					path: Schema.String,
					name: Schema.String,
					tags: Schema.optionalWith(Schema.Array(Schema.String), {
						default: () => [],
					}),
					extraData: Schema.optional(Schema.Array(Schema.String)),
				}),
			),
		)(json("icons.json"));
		icons = entries.map((e) => {
			const path = raw.has(prefix + e.path) ? e.path : `icons/${e.path}`;
			const data = decodeAsset(path);
			return {
				id: hash(data),
				name: e.name,
				tags: e.tags,
				...(e.extraData ? { extraData: e.extraData } : {}),
				data,
			};
		});
	} else {
		const font = Schema.decodeUnknownSync(
			Schema.Struct({
				name: Schema.optional(Schema.String),
				font_family: Schema.optional(Schema.String),
				glyphs: Schema.Array(
					Schema.Struct({
						name: Schema.String,
						font_class: Schema.String,
						unicode: Schema.String,
					}),
				),
			}),
		)(json("iconfont.json"));
		name = font.name ?? font.font_family ?? "Iconfont";
		const js = raw.get(`${prefix}iconfont.js`)?.toString("utf8");
		// Symbol definitions are data only. Never evaluate the surrounding JavaScript.
		if (!js) {
			if (!renderFont) throw new Error("Native font rendering unavailable");
			const icons = await renderFont(read("iconfont.ttf"), font.glyphs);
			if (!icons.length) return invalid();
			return { id: hash(bytes), name, icons };
		}
		const symbols = new Map<string, string>();
		for (const match of js.matchAll(
			/<symbol\b([^>]*?)>([\s\S]*?)<\/symbol>/g,
		)) {
			const attributes = match[1] ?? "",
				body = match[2] ?? "";
			const id = /\bid=["']([^"']+)["']/.exec(attributes)?.[1];
			const view =
				/\bviewBox=["']([\d.\s-]+)["']/.exec(attributes)?.[1] ??
				"0 0 1024 1024";
			if (id)
				symbols.set(
					id,
					`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view}">${body}</svg>`,
				);
		}
		icons = font.glyphs.map((g) => {
			const source =
				symbols.get(`icon-${g.font_class}`) ?? symbols.get(g.font_class);
			if (!source) return invalid();
			const data = svgData(source);
			return {
				id: hash(data),
				name: g.name,
				tags: [g.font_class, g.unicode],
				data,
			};
		});
	}
	if (!name.trim() || !icons.length || icons.length > 8000) return invalid();
	return { id: hash(bytes), name, icons };
}
