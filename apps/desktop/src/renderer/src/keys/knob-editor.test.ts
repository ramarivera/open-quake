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

it("ignores JSON record order in a saved knob but retains concurrent knob conflict protection", () => {
	const profile = (revision: number, config: Record<string, unknown>) =>
		Schema.decodeUnknownSync(Profile)({
			id: "p",
			name: "Profile",
			revision,
			pages: [{ id: "page", keys: [] }],
			knob: { keyCode: "0,1", config },
		});
	const baseline = profile(2, {
		type: "knob",
		future: { enabled: true, level: 4 },
	});
	const reordered = profile(3, {
		future: { level: 4, enabled: true },
		type: "knob",
	});
	expect(knobDraftRevision(baseline, reordered)).toBe(3);
	expect(
		knobDraftRevision(
			baseline,
			profile(3, { type: "knob", future: { enabled: false, level: 4 } }),
		),
	).toBe(2);
});
