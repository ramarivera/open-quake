/** Mounted Keys editor coverage for profiles-key-grid 2.2/2.3/2.4. Hidden mock windows only. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Option, Schema } from "effect";
import {
	createEmptyProfileKey,
	Profile,
	ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { ProfileRepository } from "../../../../../packages/device/src/profiles/profile-repository.js";
import type { Harness } from "./smoke-editor";

export async function verifyGeometryPagesImport(h: Harness): Promise<void> {
	const {
		manager: win,
		profiles,
		ready,
		click,
		select,
		input,
		button,
		evalIn,
		snapshot,
	} = h;
	const key = (code: string, extra: Record<string, unknown> = {}) => {
		const empty = Schema.encodeSync(ProfileKey)(createEmptyProfileKey(code));
		return {
			...empty,
			childrenName: "hotkey",
			config: {
				...empty.config,
				type: "hotkey",
				actions: [{ type: "key", value: "a" }],
				title: { ...empty.config.title, text: code },
				...extra,
			},
		};
	};
	const fixture = Schema.decodeUnknownSync(Profile)({
		id: "geometry-editor",
		name: "Geometry scenarios",
		revision: 0,
		pages: [
			{
				id: "one",
				keys: [
					key("1,1"),
					key("1,2"),
					key("2,1", {
						basicEditableItems: {
							title: false,
							grid: false,
							icon: false,
							allowDelete: false,
							allowDrag: false,
						},
					}),
				],
			},
		],
		knob: { keyCode: "0,1", config: { subActions: [{ nested: "retained" }] } },
	});
	await profiles.runtime.runPromise(
		Effect.flatMap(ProfileRepository, (repo) =>
			repo.transact((env) =>
				Effect.succeed({ ...env, profiles: [...env.profiles, fixture] }),
			),
		),
	);
	const saved = async () =>
		(
			await profiles.runtime.runPromise(
				Effect.flatMap(ProfileRepository, (repo) => repo.load()),
			)
		).envelope;
	const profile = async () => {
		const p = (await saved()).profiles.find((p) => p.id === fixture.id);
		assert(p);
		return p;
	};
	await ready(
		win,
		`document.querySelector('#keys-profile option[value="${fixture.id}"]')`,
	);
	await select(win, "#keys-profile", fixture.id);
	await ready(
		win,
		"document.querySelector('#keys-page option[value=one]') && document.querySelector('#keys-page').value === 'one'",
	);
	await click(win, ".keys-cells button:first-child");
	await ready(win, "document.querySelector('#key-title')?.value === '1,1'");
	const initial = await profile();
	const settled = () =>
		ready(
			win,
			"document.querySelector('.key-editor')?.getAttribute('aria-busy') === 'false'",
		);
	process.stdout.write("geometry smoke: move and swap\n");
	await select(win, "#key-destination", "2,8");
	assert.equal((await profile()).revision, 0, "move stays draft until Save");
	await button(win, "Save");
	await settled();
	await ready(win, "document.body.innerText.includes('Saved successfully')");
	assert.deepEqual(
		(await profile()).pages[0].keys.find((k) => k.keyCode === "2,8")?.config,
		initial.pages[0].keys[0]?.config,
	);
	await select(win, "#key-destination", "1,2");
	await button(win, "Save");
	await settled();
	await ready(
		win,
		"document.querySelector('#key-destination')?.value === '1,2'",
	);
	assert.equal(
		(await profile()).pages[0].keys.find((k) => k.keyCode === "2,8")?.config
			.title.text,
		"1,2",
		"swap retains destination configuration",
	);
	const revision = (await profile()).revision;
	await select(win, "#key-destination", "2,1");
	await button(win, "Save");
	await settled();
	assert.equal(
		(await profile()).revision,
		revision,
		"locked swap never commits",
	);
	await button(win, "Cancel");
	await click(win, ".keys-cells button:nth-child(9)");
	await ready(win, "document.querySelector('#key-title')?.value === '2,1'");
	for (const selector of [
		"#key-title",
		"#key-span",
		"#key-destination",
		"#key-function",
	])
		assert.equal(
			await evalIn(
				win,
				`document.querySelector('${selector}').matches(':disabled')`,
			),
			true,
			`${selector} respects lock`,
		);
	assert.equal(
		await evalIn(
			win,
			"Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Delete').matches(':disabled')",
		),
		true,
	);
	await evalIn(
		win,
		"document.querySelector('#key-destination').scrollIntoView({block:'center'})",
	);
	assert.equal(
		await evalIn(
			win,
			"Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Icon Library').matches(':disabled')",
		),
		true,
	);
	await snapshot(win, "editor-locks-en");
	await button(win, "Cancel");
	// Move back beside the swapped tile, then prove span confirmation is necessary.
	await click(win, ".keys-cells button:nth-child(2)");
	await select(win, "#key-destination", "1,1");
	await button(win, "Save");
	await settled();
	await ready(
		win,
		"document.querySelector('#key-destination')?.value === '1,1'",
	);
	// Create an adjacent key using the actual Function editor.
	await click(win, ".keys-cells button:nth-child(2)");
	await select(win, "#key-function", "hotkey");
	await input(win, "#key-action-0", "b");
	await button(win, "Save");
	await settled();
	await click(win, ".keys-cells button:first-child");
	await select(win, "#key-span", "2,1");
	await ready(win, "document.querySelector('#key-confirm-overlap')");
	const beforeSpan = (await profile()).revision;
	await button(win, "Save");
	await settled();
	assert.equal((await profile()).revision, beforeSpan);
	await evalIn(
		win,
		"document.querySelector('#key-confirm-overlap').scrollIntoView({block:'center'})",
	);
	await snapshot(win, "editor-overlap-en");
	await click(win, "#key-confirm-overlap");
	await button(win, "Save");
	await settled();
	assert.equal((await profile()).revision, beforeSpan + 1);
	assert.equal(
		(await profile()).pages[0].keys.some((k) => k.keyCode === "1,2"),
		false,
	);
	await evalIn(
		win,
		"document.querySelector('#key-destination').scrollIntoView({block:'center'})",
	);
	await snapshot(win, "editor-geometry-en");
	process.stdout.write("geometry smoke: page lifecycle\n");
	const knob = (await profile()).knob;
	await click(win, "#keys-add-page");
	await ready(win, "document.querySelector('#keys-page').options.length === 2");
	const added = (await profile()).pages[1];
	assert(added);
	assert.equal(
		(await saved()).activeByDevice["desktop-preview"]?.pageId,
		added.id,
	);
	await click(win, "#keys-next-page");
	await ready(win, "document.querySelector('#keys-page').value === 'one'");
	await click(win, "#keys-previous-page");
	await ready(
		win,
		`document.querySelector('#keys-page').value === ${JSON.stringify(added.id)}`,
	);
	await input(win, "#keys-page-number", "99");
	await click(win, "#keys-go-page");
	await ready(
		win,
		`document.querySelector('#keys-page').value === ${JSON.stringify(added.id)}`,
	);
	await profiles.runtime.runPromise(
		Effect.flatMap(ProfileRepository, (repo) =>
			repo.select({
				deviceId: "other-preview",
				profileId: fixture.id,
				pageId: added.id,
			}),
		),
	);
	await click(win, "#keys-delete-page");
	await snapshot(win, "editor-delete-page-en");
	await click(win, "#keys-confirm-delete-page");
	await ready(win, "document.querySelector('#keys-page').options.length === 1");
	assert.equal((await saved()).activeByDevice["other-preview"]?.pageId, "one");
	assert.deepEqual((await profile()).knob, knob);
	assert.equal(
		await evalIn(
			win,
			"document.querySelector('#keys-delete-page').matches(':disabled')",
		),
		true,
	);
	await select(win, "#keys-language", "de");
	await click(win, ".keys-cells button:first-child");
	await ready(win, "document.querySelector('#key-span')");
	await evalIn(
		win,
		"document.querySelector('#key-destination').scrollIntoView({block:'center'})",
	);
	await snapshot(win, "editor-geometry-de");
	await button(win, "Abbrechen");
	await click(win, ".keys-import > summary");
	process.stdout.write("geometry smoke: diagnosed import\n");
	const raw = [
		key("1,1", {
			type: "cameraView",
			supportKnob: null,
			actions: [null, {}, { type: "", value: "" }],
			alterIcon: null,
		}),
		{ keyCode: "0,1", config: { nested: "kept" } },
	];
	await input(win, "#keys-import-json", JSON.stringify(raw));
	await click(win, "#keys-inspect-import");
	await ready(
		win,
		"document.querySelector('[data-code=unknown-function]') && document.querySelector('[data-code=legacy-sentinel]') && document.querySelector('[data-code=missing-optional]')",
	);
	await evalIn(
		win,
		"document.querySelector('.keys-import-report').scrollIntoView({block:'center'})",
	);
	await snapshot(win, "editor-import-de");
	await select(win, "#keys-language", "en");
	await snapshot(win, "editor-import-en");
	const count = (await saved()).profiles.length;
	await click(win, "#keys-confirm-import");
	await ready(
		win,
		`document.querySelector('#keys-profile').options.length === ${count + 1}`,
	);
	const imported = (await saved()).profiles.at(-1);
	assert(imported);
	assert.equal(
		Option.getOrThrow(imported.pages[0].keys[0]?.compatibility ?? Option.none())
			.unsupported,
		true,
	);
	assert.deepEqual(
		JSON.parse(
			JSON.stringify(Option.getOrThrow(imported.compatibility).source),
		),
		raw,
	);
	assert.equal(Option.getOrThrow(imported.knob).config.nested, "kept");
	await ready(
		win,
		`document.querySelector('#keys-profile').value === ${JSON.stringify(imported.id)}`,
	);
	await click(win, ".keys-cells button:first-child");
	await ready(
		win,
		"document.querySelector('.key-unsupported')?.textContent.includes('Unsupported function')",
	);
	await input(win, "#keys-import-json", "{broken");
	await click(win, "#keys-inspect-import");
	await ready(win, "document.querySelector('[data-code=invalid-field]')");
	assert.equal(
		await evalIn(
			win,
			"document.querySelector('#keys-confirm-import').matches(':disabled')",
		),
		true,
	);
	await snapshot(win, "editor-import-invalid-en");
	await writeFile(
		join(h.scratch, "geometry-page-import.json"),
		JSON.stringify(
			{
				scenarios: 16,
				finalProfile: Schema.encodeSync(Profile)(await profile()),
				importedProfile: Schema.encodeSync(Profile)(imported),
			},
			null,
			2,
		),
	);
	process.stdout.write(
		"Mounted geometry/page/import PASS: 16 scenarios, English and German screenshots.\n",
	);
}
