import { describe, expect, it } from "vitest";
import { iconZip } from "../test/icon-pack-fixtures";
import { parseIconPack, safeIconSvg } from "./icon-packs";
import { readIconZip } from "./zip";

const svg =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24z"/></svg>';
describe("safe icon packs", () => {
	it("imports a wrapped Stream Deck icon pack and stable metadata", async () => {
		const bytes = iconZip([
			{
				name: "pack/manifest.json",
				data: JSON.stringify({ Name: "Test icons" }),
			},
			{
				name: "pack/icons.json",
				data: JSON.stringify([
					{ path: "square.svg", name: "Square", tags: ["shape"] },
				]),
			},
			{ name: "pack/icons/square.svg", data: svg },
		]);
		const pack = await parseIconPack(bytes, () => {
			throw new Error("Unexpected raster");
		});
		expect(pack.name).toBe("Test icons");
		expect(pack.icons[0]).toMatchObject({ name: "Square", tags: ["shape"] });
		expect(pack.icons[0]?.data).toMatch(/^data:image\/svg\+xml;base64,/);
		expect((await parseIconPack(bytes, () => "")).id).toBe(pack.id);
	});
	it("reads iconfont symbols without executing the surrounding script", async () => {
		const bytes = iconZip([
			{
				name: "iconfont.json",
				data: JSON.stringify({
					name: "Shapes",
					glyphs: [{ name: "Square", font_class: "square", unicode: "e001" }],
				}),
			},
			{
				name: "iconfont.js",
				data: `throw new Error("MUST NEVER EXECUTE");const x='<svg><symbol id="icon-square" viewBox="0 0 24 24"><path d="M0 0h24v24z"/></symbol></svg>'`,
			},
		]);
		const pack = await parseIconPack(bytes, () => "");
		expect(pack.icons).toHaveLength(1);
		expect(pack.name).toBe("Shapes");
	});
	it("uses the native font conversion seam for TTF-only packs", async () => {
		const bytes = iconZip([
			{
				name: "iconfont.json",
				data: JSON.stringify({
					font_family: "Font",
					glyphs: [{ name: "A", font_class: "a", unicode: "0041" }],
				}),
			},
			{ name: "iconfont.ttf", data: "font" },
		]);
		let called = false;
		const pack = await parseIconPack(
			bytes,
			() => "",
			async (font, glyphs) => {
				called = true;
				expect(font.toString()).toBe("font");
				expect(glyphs[0]?.unicode).toBe("0041");
				return [
					{
						id: "glyph",
						name: "A",
						tags: [],
						data: "data:image/png;base64,AA==",
					},
				];
			},
		);
		expect(called).toBe(true);
		expect(pack.icons).toHaveLength(1);
	});
	it.each(["../evil", "/evil", "C:/evil", "folder/../evil", "a\\evil"])(
		"rejects path %s",
		(name) =>
			expect(() => readIconZip(iconZip([{ name, data: "x" }]))).toThrow(),
	);
	it("rejects CRC corruption and duplicate entries", () => {
		const bytes = iconZip([{ name: "a", data: "abc" }]);
		bytes[31] = 88;
		expect(() => readIconZip(bytes)).toThrow();
		expect(() =>
			readIconZip(
				iconZip([
					{ name: "a", data: "a" },
					{ name: "a", data: "b" },
				]),
			),
		).toThrow();
	});
	it.each([
		"<svg><script>alert(1)</script></svg>",
		'<svg onload="x"></svg>',
		'<svg><image href="https://example.com"/></svg>',
		"<!DOCTYPE svg><svg></svg>",
		'<svg><path fill="url(https://example.com)"/></svg>',
		"<svg><foreignObject/></svg>",
	])("rejects unsafe SVG %s", (source) =>
		expect(() => safeIconSvg(source)).toThrow(),
	);
});

it.each([
	'<svg><path/d="M0 0" onload="x"/></svg>',
	'<svg><path foo="unchecked"/></svg>',
	'<svg><path d="M0 0"/garbage></svg>',
	"<svg><g></svg>",
	"<svg/><svg></svg>",
	'<svg><path fill="red"fill="blue"/></svg>',
	'<svg><path xml:base="https://example.com"/></svg>',
	"<svg><path d=M0/></svg>",
	'<svg><path d="M0 0"/> <script/x="y"/></svg>',
])("rejects malformed or unchecked SVG %s", (source) =>
	expect(() => safeIconSvg(source)).toThrow(),
);
