/** Final review regressions through production renderer, IPC and persistence. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import type { BrowserWindow } from "electron";
import {
	createEmptyProfileKey,
	Profile,
	ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { ProfileRepository } from "../../../../../packages/device/src/profiles/profile-repository.js";
import { KeyReply } from "../../shared/key-library";
import { ProfileReplySchema } from "../../shared/profile-manager";
import type { Harness } from "./smoke-editor";

export async function verifyFinalReview(
	h: Harness,
	panel: BrowserWindow,
): Promise<void> {
	const {
		manager: win,
		profiles,
		ready,
		evalIn,
		select,
		click,
		button,
		input,
		snapshot,
	} = h;
	const svg = (color: string) =>
		`data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="${color}"/></svg>`).toString("base64")}`;
	const png =
		"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1X8AAAAASUVORK5CYII=";
	const empty = Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1"));
	const makeKey = (code: string, type: string, icon: string) => ({
		...empty,
		keyCode: code,
		childrenName: type,
		config: {
			...empty.config,
			type,
			display: true,
			icon,
			title: {
				...empty.config.title,
				text: "Record",
				display: true,
				i18nKey: "defaultMeetingAssistantConfig.record",
			},
			actions:
				type === "hotkeySwitch"
					? [
							{ type: "key", value: "a" },
							{ type: "key", value: "b" },
						]
					: [
							{ type: "emojiAction", value: 1 },
							{
								type: "emojiConfig",
								value: {
									packageId: "synthetic",
									emojiId: code,
									hash: "a".repeat(64),
								},
							},
						],
		},
	});
	const primary = makeKey("1,1", "hotkeySwitch", svg("red"));
	const fixture = Schema.decodeUnknownSync(Profile)({
		id: "final-review",
		name: "Final review",
		revision: 0,
		pages: [
			{
				id: "one",
				keys: [
					{
						...primary,
						config: {
							...primary.config,
							alterTitle: {
								...empty.config.title,
								text: "Alternate",
								display: true,
							},
							userModifiedAlterTitle: true,
							alterIcon: svg("blue"),
						},
					},
					makeKey("1,2", "emoji", svg("green")),
					makeKey("1,3", "emoji", png),
					makeKey("1,4", "emoji", ""),
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
	await profiles.refresh();
	await select(win, "#keys-profile", fixture.id);
	await ready(
		win,
		"document.querySelector('#keys-profile')?.value === 'final-review'",
	);
	const tile = (code: string) => `[data-key-code="${code}"]`;
	const text = (code: string) =>
		`document.querySelector(${JSON.stringify(`${tile(code)} .strip-tile-title`)})?.textContent`;
	const savedProfile = async () => {
		const result = await profiles.runtime.runPromise(
			Effect.flatMap(ProfileRepository, (repo) => repo.load()),
		);
		const profile = result.envelope.profiles.find((p) => p.id === fixture.id);
		assert(profile);
		return profile;
	};
	const tap = async () => {
		const revision = (await savedProfile()).revision;
		for (const kind of ["press", "release"]) {
			const reply = Schema.decodeUnknownSync(KeyReply)(
				await evalIn(
					panel,
					`window.quakeKeyLibrary.request(${JSON.stringify({ type: "activate", deviceId: "desktop-preview", profileId: fixture.id, pageId: "one", keyCode: "1,1", revision, kind })})`,
				),
			);
			assert.equal(reply._tag, "success");
		}
	};
	await tap();
	await ready(panel, `${text("1,1")} === 'Alternate'`);
	await click(win, ".keys-cells button:first-child");
	await select(win, "#key-function", "hotkey");
	await input(win, "#key-action-0", "c");
	await input(win, "#key-title", "Replacement");
	await button(win, "Save");
	await ready(
		win,
		"document.querySelector('.key-editor')?.getAttribute('aria-busy') === 'false' && document.body.innerText.includes('Saved successfully')",
	);
	await ready(panel, `${text("1,1")} === 'Replacement'`);
	assert.equal(
		await evalIn(
			panel,
			`document.querySelector(${JSON.stringify(`${tile("1,1")} img`)})?.getAttribute('src')`,
		),
		svg("red"),
	);
	await tap();
	await ready(panel, `${text("1,1")} === 'Replacement'`);
	await snapshot(panel, "final-review-live-replacement");

	// Navigate out of Keys and back, then reload management while the live strip stays mounted.
	await select(win, "#keys-language", "de");
	await ready(panel, `${text("1,2")} === 'Aufnahme'`);
	await evalIn(
		win,
		"document.querySelector('.nav-item[data-nav-page=profiles]').click()",
	);
	await button(win, "Keys");
	await ready(win, "document.querySelector('#keys-language')?.value === 'de'");
	assert.equal(
		await evalIn(win, "localStorage.getItem('open-quake-key-locale')"),
		"de",
	);
	await ready(panel, `${text("1,2")} === 'Aufnahme'`);
	await win.loadURL(win.webContents.getURL());
	await button(win, "Keys");
	await ready(win, "document.querySelector('#keys-language')?.value === 'de'");
	await select(win, "#keys-profile", fixture.id);
	await snapshot(win, "final-review-restored-locale");
	await evalIn(
		win,
		"document.querySelector('.nav-item[data-nav-page=profiles]').click()",
	);
	await evalIn(win, "localStorage.setItem('open-quake-key-locale','invalid')");
	await button(win, "Keys");
	await ready(win, "document.querySelector('#keys-language')?.value === 'en'");
	await ready(panel, `${text("1,2")} === 'Record'`);
	assert.equal(
		await evalIn(win, "localStorage.getItem('open-quake-key-locale')"),
		"en",
	);
	await select(win, "#keys-profile", fixture.id);

	// Choose a real MDI icon, save it, and check preview, live strip and thumbnail consumers.
	await click(win, ".keys-cells button:nth-child(2)");
	await button(win, "Icon Library");
	await click(await h.iconPicker(win), ".icon-library-cell button");
	await button(win, "Save");
	await ready(
		win,
		"document.querySelector('.key-editor')?.getAttribute('aria-busy') === 'false' && document.body.innerText.includes('Saved successfully')",
	);
	const saved = await savedProfile();
	const savedEmoji = saved.pages[0].keys.find((k) => k.keyCode === "1,2");
	const mdi = savedEmoji?.config.icon;
	assert(mdi?.startsWith("data:image/png;base64,"));
	assert.notEqual(mdi, svg("green"));
	assert.deepEqual(
		savedEmoji?.config.actions,
		fixture.pages[0].keys[1]?.config.actions,
	);
	for (const owner of [win, panel])
		for (const [code, image] of [
			["1,2", mdi],
			["1,3", png],
		] as const) {
			await ready(
				owner,
				`(()=>{const img=document.querySelector(${JSON.stringify(`${tile(code)} img`)});return img?.getAttribute('src')===${JSON.stringify(image)}&&img.complete&&img.naturalWidth>0})()`,
			);
		}
	await snapshot(panel, "final-review-custom-emoji");
	const thumbnail = Schema.decodeUnknownSync(ProfileReplySchema)(
		await evalIn(
			win,
			`window.quakeProfileManager.request({type:'thumbnail',id:'final-review',locale:'en'})`,
		),
	);
	assert.equal(
		thumbnail._tag,
		"success",
		"custom and empty emoji icons must not block thumbnail readiness",
	);
	await profiles.refresh();
	await panel.loadURL(panel.webContents.getURL());
	await ready(
		panel,
		`document.querySelector(${JSON.stringify(`${tile("1,2")} img`)})?.getAttribute('src') === ${JSON.stringify(mdi)}`,
	);
	await writeFile(
		join(h.scratch, "final-review-consumers.json"),
		JSON.stringify(
			{
				alternateReplacement: true,
				retainedEmojiActions: true,
				localeRemount: "de",
				localeReload: "de",
				invalidLocale: "en",
				mdi: true,
				localPng: true,
				emptyThumbnail: true,
			},
			null,
			2,
		),
	);
	process.stdout.write(
		"Final review PASS: live alternate replacement; persisted/invalid locale across remount/reload; MDI/local emoji preview, Save, strip and thumbnail.\n",
	);
}
