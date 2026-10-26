import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { createEmptyProfileKey } from "../../../../../../packages/device/src/profiles/profile-contracts.js";
import { KeyGeometryControls } from "./KeyGeometryControls";
import { KeyTitleSettings } from "./KeyTitleSettings";

for (const [locale, title, first, last] of [
	["en", "Title style", "Row 1 · Column 1", "Row 2 · Column 8"],
	["de", "Titelstil", "Zeile 1 · Spalte 1", "Zeile 2 · Spalte 8"],
] as const)
	it(`renders complete title and readable destination labels in ${locale}`, () => {
		const keyValue = createEmptyProfileKey("1,1");
		const titleMarkup = renderToStaticMarkup(
			createElement(KeyTitleSettings, {
				keyValue,
				alternate: false,
				locale,
				onChange: () => {},
			}),
		);
		expect(titleMarkup).toContain(`<summary>${title}</summary>`);
		const geometry = renderToStaticMarkup(
			createElement(KeyGeometryControls, {
				keyValue,
				geometry: {},
				locale,
				onChange: () => {},
			}),
		);
		expect(geometry).toMatch(new RegExp(`value="1,1"[^>]*>${first}</option>`));
		expect(geometry).toContain(`<option value="2,8">${last}</option>`);
	});
