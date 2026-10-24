/** Review regressions through mounted controls, IPC, persistence and recorded runtime effects. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Layer, Option, Schema } from "effect";
import { executeActionLeaf } from "../../../../../packages/device/src/actions/action-service.js";
import {
	KeyRuntime,
	KeyRuntimePort,
} from "../../../../../packages/device/src/actions/key-runtime-service.js";
import { keyText } from "../../../../../packages/device/src/profiles/key-editing-invariants.js";
import {
	createEmptyProfileKey,
	Profile,
	ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { ProfileRepository } from "../../../../../packages/device/src/profiles/profile-repository.js";
import type { Harness } from "./smoke-editor";

export async function verifyReviewEditor(
	h: Harness,
	probe?: string,
): Promise<void> {
	const {
		manager: win,
		profiles,
		ready,
		evalIn,
		select,
		click,
		input,
		button,
		snapshot,
	} = h;
	const empty = Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1"));
	const icon = (color: string) =>
		`data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="${color}"/></svg>`).toString("base64")}`;
	const imported = {
		...empty,
		childrenName: "futureFunction",
		compatibility: {
			unsupported: true,
			vendor: "retained",
			source: {
				config: {
					type: "futureFunction",
					actions: [{ type: "website", value: "https://obsolete.invalid" }],
				},
			},
		},
		config: {
			...empty.config,
			type: "futureFunction",
			display: true,
			title: { ...empty.config.title, text: "Imported", display: true },
			compatibility: { vendorPayload: "retained" },
			actions: [{ type: "website", value: "https://obsolete.invalid" }],
		},
	};
	const switched = (code: string) => ({
		...empty,
		keyCode: code,
		childrenName: "hotkeySwitch",
		config: {
			...empty.config,
			type: "hotkeySwitch",
			display: true,
			userModifiedTitle: true,
			title: { ...empty.config.title, text: "Primary", display: true },
			icon: icon("red"),
			alterTitle: { ...empty.config.title, text: "Alternate", display: true },
			userModifiedAlterTitle: true,
			alterIcon: icon("blue"),
			actions: [
				{ type: "key", value: "a" },
				{ type: "key", value: "b" },
			],
		},
	});
	const { alterTitle: omittedTitle, ...fallbackConfig } =
		switched("1,4").config;
	assert(omittedTitle);
	const { alterIcon: omittedIcon, ...missingIconConfig } = fallbackConfig;
	assert(omittedIcon);
	const fixture = Schema.decodeUnknownSync(Profile)({
		id: "review-editor",
		name: "Review editor",
		revision: 0,
		pages: [
			{
				id: "one",
				keys: [
					imported,
					switched("1,2"),
					switched("1,3"),
					{ ...switched("1,4"), config: { ...fallbackConfig, alterIcon: "" } },
					{
						...switched("1,5"),
						config: {
							...missingIconConfig,
							alterTitle: {
								...empty.config.title,
								text: "Timer",
								i18nKey: "timer",
								display: true,
							},
							userModifiedAlterTitle: false,
						},
					},
				],
			},
		],
	});
	await profiles.runtime.runPromise(
		Effect.flatMap(ProfileRepository, (repo) =>
			repo.transact((env) =>
				Effect.succeed({ ...env, profiles: [...env.profiles, fixture] }),
			),
		),
	);
	const committed = () =>
		profiles.runtime.runPromise(
			Effect.flatMap(ProfileRepository, (repo) => repo.load()),
		);
	const saved = async (code: string) => {
		const key = (await committed()).envelope.profiles
			.find((p) => p.id === fixture.id)
			?.pages[0]?.keys.find((k) => k.keyCode === code);
		assert(key);
		return key;
	};
	const save = async () => {
		await button(win, "Save");
		await ready(
			win,
			"document.querySelector('.key-editor')?.getAttribute('aria-busy') === 'false' && document.body.innerText.includes('Saved successfully')",
		);
	};
	const tile = (code: string) => `.keys-preview [data-key-code="${code}"]`;
	const title = (code: string) => `${tile(code)} .strip-tile-title`;
	const calls: string[] = [];
	const execute = async (code: string) => {
		const env = (await committed()).envelope;
		await Effect.runPromise(
			Effect.gen(function* () {
				yield* KeyRuntime.activate("recorded", code, "press");
				yield* KeyRuntime.activate("recorded", code, "release");
			}).pipe(
				Effect.provide(
					KeyRuntime.DefaultWithoutDependencies.pipe(
						Layer.provide(
							Layer.succeed(KeyRuntimePort, {
								read: Effect.succeed({
									...env,
									activeByDevice: {
										recorded: { profileId: fixture.id, pageId: "one" },
									},
								}),
								execute: (config) =>
									executeActionLeaf(config, {
										keyboard: Option.some({
											supportedTokens: new Set(["a", "b", "c"]),
											pressChord: (chord) =>
												Effect.sync(() => {
													calls.push(`key:${chord}`);
												}),
										}),
										website: Option.some({
											openUrl: (url) =>
												Effect.sync(() => {
													calls.push(`url:${url}`);
												}),
										}),
										text: Option.none(),
										application: Option.none(),
										media: Option.none(),
									}),
								publish: () => Effect.void,
								select: () => Effect.void,
								alarm: () => Effect.void,
							}),
						),
					),
				),
				Effect.scoped,
			),
		);
	};
	await ready(
		win,
		`document.querySelector('#keys-profile option[value="review-editor"]')`,
	);
	await select(win, "#keys-profile", fixture.id);
	await ready(
		win,
		"document.querySelector('#keys-profile')?.value === 'review-editor' && !document.querySelector('#key-title')",
	);
	if (!probe || probe === "replacement") {
		await click(win, ".keys-cells button:first-child");
		await input(win, "#key-title", "Cosmetic");
		await click(win, ".key-title-settings summary");
		await select(win, "#key-title-position", "mid");
		await button(win, "Icon Library");
		await click(await h.iconPicker(win), ".icon-library-cell button");
		await save();
		const cosmetic = await saved("1,1");
		assert.equal(cosmetic.config.title.pos, "mid");
		assert.match(cosmetic.config.icon, /^data:image\/png;base64,/);
		assert.equal(Option.getOrThrow(cosmetic.compatibility).unsupported, true);
		await execute("1,1");
		assert.deepEqual(calls, []);
		await select(win, "#key-function", "hotkey");
		await input(win, "#key-action-0", "c");
		await save();
		const replacement = await saved("1,1");
		assert.notEqual(
			Option.getOrThrow(replacement.compatibility).unsupported,
			true,
			"explicit supported Function must leave quarantine",
		);
		assert.equal(
			Option.getOrThrow(replacement.compatibility).vendor,
			"retained",
		);
		assert.deepEqual(
			JSON.parse(
				JSON.stringify(Option.getOrThrow(replacement.compatibility).source),
			),
			imported.compatibility.source,
		);
		assert.equal(
			Option.getOrThrow(replacement.config.compatibility).vendorPayload,
			"retained",
		);
		assert.deepEqual(replacement.config.actions, [{ type: "key", value: "c" }]);
		await execute("1,1");
		assert.deepEqual(calls, ["key:c"]);
		assert(
			await evalIn(
				win,
				`document.querySelector(${JSON.stringify(title("1,1"))})?.textContent === 'Cosmetic'`,
			),
		);
		await snapshot(win, "supported-replacement-saved");
		process.stdout.write(
			"Review replacement PASS: mounted Function/preview/Save/persistence/KeyRuntime; cosmetic quarantine; retained import payload inert.\n",
		);
	}
	if (!probe || probe === "alternate") {
		await click(win, ".keys-cells button:nth-child(2)");
		await button(win, "2");
		assert.equal(
			await evalIn(
				win,
				`document.querySelector(${JSON.stringify(title("1,2"))})?.textContent`,
			),
			"Alternate",
			"State 2 must reach the mounted grid",
		);
		assert.equal(
			await evalIn(
				win,
				`document.querySelector(${JSON.stringify(title("1,3"))})?.textContent`,
			),
			"Primary",
			"only the selected draft projects State 2",
		);
		await input(win, "#key-title", "Alt");
		await click(win, ".key-title-settings summary");
		await select(win, "#key-title-position", "mid");
		await input(win, "#key-title-size", "14");
		await click(win, 'button[aria-label="italic"]');
		await button(win, "Icon Library");
		await click(await h.iconPicker(win), ".icon-library-cell button");
		await ready(
			win,
			`document.querySelector(${JSON.stringify(title("1,2"))})?.textContent === 'Alt'`,
		);
		assert.equal(
			await evalIn(
				win,
				`document.querySelector(${JSON.stringify(title("1,2"))}).style.fontStyle`,
			),
			"italic",
		);
		assert.equal(
			await evalIn(
				win,
				`document.querySelector(${JSON.stringify(title("1,2"))}).style.top`,
			),
			"50%",
		);
		const alternateIcon = await evalIn(
			win,
			`document.querySelector(${JSON.stringify(`${tile("1,2")} img`)}).getAttribute('src')`,
		);
		assert.notEqual(alternateIcon, icon("red"));
		assert.notEqual(alternateIcon, icon("blue"));
		await snapshot(win, "alternate-draft-preview");
		await save();
		const alternate = await saved("1,2");
		assert.equal(alternate.config.title.text, "Primary");
		assert.equal(alternate.config.icon, icon("red"));
		assert.equal(Option.getOrThrow(alternate.config.alterTitle).text, "Alt");
		assert.equal(Option.getOrThrow(alternate.config.alterIcon), alternateIcon);
		assert.deepEqual(
			alternate.config.actions,
			fixture.pages[0].keys[1]?.config.actions,
		);
		await button(win, "1");
		assert.equal(
			await evalIn(
				win,
				`document.querySelector(${JSON.stringify(title("1,2"))})?.textContent`,
			),
			"Primary",
		);
		await snapshot(win, "primary-draft-preview");
		await button(win, "2");
		await input(win, "#key-title", "");
		assert.equal(
			await evalIn(
				win,
				`document.querySelector(${JSON.stringify(title("1,2"))})?.textContent`,
			),
			"",
			"explicit custom blank alternate title stays blank",
		);
		await select(win, "#keys-language", "de");
		assert.equal(
			await evalIn(
				win,
				`document.querySelector(${JSON.stringify(title("1,2"))})?.textContent`,
			),
			"",
		);
		await click(win, ".keys-cells button:nth-child(4)");
		await button(win, "2");
		assert.equal(
			await evalIn(
				win,
				`document.querySelector(${JSON.stringify(title("1,4"))})?.textContent`,
			),
			"Primary",
		);
		assert.equal(
			await evalIn(
				win,
				`document.querySelector(${JSON.stringify(`${tile("1,4")} img`)})?.getAttribute('src')`,
			),
			icon("red"),
			"blank alternate icon falls back to primary",
		);
		await select(win, "#keys-language", "en");
		await click(win, ".keys-cells button:nth-child(5)");
		await button(win, "2");
		await select(win, "#keys-language", "de");
		assert.equal(
			await evalIn(
				win,
				`document.querySelector(${JSON.stringify(title("1,5"))})?.textContent`,
			),
			keyText("timer", "de"),
		);
		assert.equal(
			await evalIn(
				win,
				`document.querySelector(${JSON.stringify(`${tile("1,5")} img`)})?.getAttribute('src')`,
			),
			icon("red"),
		);
		await select(win, "#keys-language", "en");
		process.stdout.write(
			"Review alternate PASS: mounted primary/alternate title/style/icon, selected draft isolation, Save, blank/missing fallback and locale.\n",
		);
	}
	if (!probe || probe === "single-state") {
		await click(win, ".keys-cells button:nth-child(3)");
		await button(win, "2");
		await select(win, "#key-function", "hotkey");
		await input(win, "#key-action-0", "c");
		await input(win, "#key-title", "Single state");
		await click(win, ".key-title-settings summary");
		await select(win, "#key-title-position", "mid");
		await button(win, "Icon Library");
		await click(await h.iconPicker(win), ".icon-library-cell button");
		await save();
		const single = await saved("1,3");
		assert.equal(
			single.config.title.text,
			"Single state",
			"single-state replacement must edit primary artwork",
		);
		assert.equal(single.config.title.pos, "mid");
		assert.notEqual(single.config.icon, icon("red"));
		assert.equal(Option.getOrThrow(single.config.alterTitle).text, "Alternate");
		assert.equal(Option.getOrThrow(single.config.alterIcon), icon("blue"));
		assert.deepEqual(single.config.actions, [{ type: "key", value: "c" }]);
		assert.equal(
			await evalIn(
				win,
				`document.querySelector(${JSON.stringify(title("1,3"))})?.textContent`,
			),
			"Single state",
		);
		await snapshot(win, "single-state-replacement");
		process.stdout.write(
			"Review single-state PASS: State 2 replacement resets artwork editing to primary without changing replacement actions.\n",
		);
	}
	await writeFile(
		join(h.scratch, "review-editor.json"),
		JSON.stringify(
			{
				calls,
				profile: Schema.encodeSync(Profile)(
					(await committed()).envelope.profiles.find(
						(p) => p.id === fixture.id,
					) ?? fixture,
				),
			},
			null,
			2,
		),
	);
}
