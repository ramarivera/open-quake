import { Schema } from "effect";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Profile } from "../../../../../../packages/device/src/profiles/profile-contracts.js";
import { KnobEditor } from "./KnobEditor";

it("blocks knob saving with a clear explanation while a key editor is open", () => {
	const profile = Schema.decodeUnknownSync(Profile)({
		id: "p",
		name: "Profile",
		revision: 0,
		pages: [{ id: "page", keys: [] }],
	});
	const html = renderToStaticMarkup(
		createElement(KnobEditor, { profile, accept: () => {}, keyEditOpen: true }),
	);
	expect(html).toContain(
		"Save your key changes, then close the key editor with Cancel before saving knob settings.",
	);
	expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save knob<\/button>/);
});
