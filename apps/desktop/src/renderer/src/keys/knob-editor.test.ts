import { Schema } from "effect";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Profile } from "../../../../../../packages/device/src/profiles/profile-contracts.js";
import { KnobEditor } from "./KnobEditor";
import { knobDraftRevision } from "./knob-draft";

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

it("rebases knob revision after key-only saves without accepting concurrent knob edits", () => {
	const baseline = Schema.decodeUnknownSync(Profile)({
		id: "p",
		name: "Profile",
		revision: 2,
		pages: [{ id: "page", keys: [] }],
	});
	const latest = { ...baseline, revision: 3 };
	expect(knobDraftRevision(baseline, latest)).toBe(3);
	expect(knobDraftRevision(baseline, { ...latest, id: "other" })).toBe(2);
	expect(knobDraftRevision(baseline, { ...latest, revision: 1 })).toBe(2);
	const editedKnob = Schema.decodeUnknownSync(Profile)({
		...Schema.encodeSync(Profile)(latest),
		knob: { keyCode: "0,1", config: { future: "changed" } },
	});
	expect(knobDraftRevision(baseline, editedKnob)).toBe(2);
});
