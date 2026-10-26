/** Native mock acceptance for the mounted grouped library and its real persistence path. */
import assert from "node:assert/strict";
import { Effect, Schema } from "effect";
import { Profile } from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { ProfileRepository } from "../../../../../packages/device/src/profiles/profile-repository.js";
import { KeyReply } from "../../shared/key-library";
import type { Harness } from "./smoke-editor";

export async function verifyAppLibrary(h: Harness): Promise<void> {
	const {
		manager: win,
		evalIn,
		ready,
		click,
		input,
		select,
		snapshot,
		profiles,
	} = h;
	const fixture = Schema.decodeUnknownSync(Profile)({
		id: "app-library-acceptance",
		name: "Library acceptance",
		revision: 0,
		pages: [{ id: "one", keys: [] }],
	});
	await profiles.runtime.runPromise(
		Effect.flatMap(ProfileRepository, (repository) =>
			repository.transact((envelope) =>
				Effect.succeed({
					...envelope,
					profiles: [...envelope.profiles, fixture],
					activeByDevice: {
						...envelope.activeByDevice,
						"desktop-preview": { profileId: fixture.id, pageId: "one" },
					},
				}),
			),
		),
	);
	await select(win, "#keys-profile", fixture.id);
	await ready(
		win,
		"document.querySelector('[data-library-type=\"apps:Discord:0\"]')",
	);
	const request = async () =>
		Schema.decodeUnknownSync(KeyReply)(
			await evalIn(
				win,
				'window.quakeKeyLibrary.request({type:"read",locale:"en"})',
			),
		);
	const place = async (id: string, code: string) => {
		await click(win, `[data-library-type="${id}"]`);
		await evalIn(
			win,
			`Array.from(document.querySelectorAll('.keys-cells button')).find(button=>button.textContent.trim()===${JSON.stringify(code)}).dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));true`,
		);
		await ready(
			win,
			"document.querySelector('.key-editor').getAttribute('aria-busy') === 'false' && document.body.innerText.includes('Saved successfully')",
		);
	};
	await place("apps:Discord:2", "1,2");
	let reply = await request();
	assert(reply._tag === "success");
	assert.deepEqual(
		reply.envelope?.profiles.find((profile) => profile.id === fixture.id)
			?.pages[0]?.keys[0]?.config.actions,
		[{ type: "key", value: "control+alt+leftbracket" }],
	);
	await place("apps:Premiere Pro:4", "2,5");
	reply = await request();
	assert(reply._tag === "success");
	const trim = reply.envelope?.profiles
		.find((profile) => profile.id === fixture.id)
		?.pages[0]?.keys.find((key) => key.keyCode === "2,5");
	assert.equal(trim?.config.supportKnob, true);
	assert.deepEqual(trim?.config.actions, [
		{ type: "key", value: "alt+left" },
		{ type: "key", value: "alt+right" },
	]);
	for (const locale of ["en", "de"]) {
		await select(win, "#keys-language", locale);
		await input(
			win,
			"#keys-library-search",
			locale === "de" ? "Stummschalten" : "Mute",
		);
		await ready(
			win,
			"!document.querySelector('[data-library-type=\"website\"]') && document.querySelector('[data-library-type=\"apps:Discord:0\"]')",
		);
		assert(
			await evalIn(
				win,
				"Array.from(document.querySelectorAll('.function-library-group')).every(group=>group.open)",
			),
		);
		await snapshot(win, `app-library-search-${locale}`);
		await input(win, "#keys-library-search", "");
		await ready(
			win,
			"document.querySelectorAll('.function-library-group[open]').length === 0",
		);
		await click(win, '[data-library-group="apps:Discord"] summary');
		await click(win, '[data-library-group="apps:Premiere Pro"] summary');
		await evalIn(
			win,
			'document.querySelector(".function-library").scrollIntoView({block:"start"});true',
		);
		await evalIn(
			win,
			`const groups=document.querySelector('.function-library-groups');groups.scrollTop=document.querySelector('[data-library-group="apps:Discord"]').offsetTop-groups.offsetTop;true`,
		);
		await snapshot(win, `app-library-groups-${locale}`);
		win.setContentSize(680, 1000);
		assert(
			await evalIn(win, "document.documentElement.scrollWidth <= innerWidth"),
		);
		await snapshot(win, `app-library-narrow-${locale}`);
		win.setContentSize(1180, 1000);
	}
	process.stdout.write(
		"App library native mock PASS: default persistence, Discord/Premiere placement, canonical chords and directional order, translated search/reset, expanded groups, EN/DE wide/narrow screenshots.\n",
	);
}
