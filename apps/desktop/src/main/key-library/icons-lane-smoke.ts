/** Icons burn-down acceptance through real mounted renderer/preload/main consumers. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { BrowserWindow } from "electron";
import {
	createEmptyProfileKey,
	Profile,
	ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { ProfileRepository } from "../../../../../packages/device/src/profiles/profile-repository.js";
import { KeyReply, type KeyRequest } from "../../shared/key-library";
import { MONITOR_ARTWORK } from "../../shared/monitor-contracts";
import {
	PROFILE_SNAPSHOT,
	ProfileReplySchema,
} from "../../shared/profile-manager";
import { foregroundArtwork } from "../monitor/foreground-artwork";
import { iconZip } from "../test/icon-pack-fixtures";
import type { Harness } from "./smoke-editor";

export async function verifyIconsLane(
	h: Harness,
	directory: string,
	setPath: (path: string) => void,
): Promise<void> {
	const {
		manager: win,
		profiles,
		evalIn,
		ready,
		click,
		button,
		input,
		select,
		snapshot,
	} = h;
	let checks = 0;
	const pass = (name: string): void => {
		checks++;
		process.stdout.write(`icons ${checks}: ${name} PASS\n`);
	};
	const request = async (window: typeof win, command: KeyRequest) =>
		Schema.decodeUnknownSync(KeyReply)(
			await evalIn(
				window,
				`window.quakeKeyLibrary.request(${JSON.stringify(command)})`,
			),
		);
	const open = async (locale: "en" | "de" = "en") => {
		const token = `icons-${crypto.randomUUID()}`;
		const pending = request(win, { type: "open-icons", token, locale });
		const picker = await h.iconPicker(win);
		return {
			token,
			pending,
			picker,
			close: async () => {
				await request(win, { type: "cancel-icons", token });
				await pending;
			},
		};
	};
	const loadPause = h.delays.pause("application-icons", "before");
	const loadToken = `loading-${crypto.randomUUID()}`;
	const loadPending = request(win, {
		type: "open-icons",
		token: loadToken,
		locale: "en",
	});
	await loadPause.entered;
	const pendingWindow = BrowserWindow.getAllWindows().find(
		(child) => child.getParentWindow() === win,
	);
	assert(pendingWindow);
	await ready(
		pendingWindow,
		"document.querySelector('.icon-library-body')?.getAttribute('aria-busy')==='true'",
	);
	assert.equal(
		await evalIn(
			pendingWindow,
			"document.querySelector('.icon-library-group small').textContent",
		),
		"…",
	);
	assert.equal(
		await evalIn(
			pendingWindow,
			"Number(document.querySelector('progress').value)",
		),
		28,
	);
	loadPause.release();
	await h.iconPicker(win);
	await request(win, { type: "cancel-icons", token: loadToken });
	await loadPending;
	pass("mounted progressive group loading and pending MDI count");
	const source =
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="red"/></svg>';
	const path = join(directory, "icons-metadata.zip");
	await writeFile(
		path,
		iconZip([
			{ name: "manifest.json", data: JSON.stringify({ Name: "Lane artwork" }) },
			{
				name: "icons.json",
				data: JSON.stringify([
					{
						path: "red.svg",
						name: "Crimson",
						tags: ["warm-colour"],
						extraData: ["lane-metadata"],
					},
				]),
			},
			{ name: "icons/red.svg", data: source },
		]),
	);
	setPath(path);
	let chooser = await open();
	await button(chooser.picker, "Import Icon");
	await ready(
		chooser.picker,
		"document.querySelector('button[aria-label=\"Lane artwork\"]') && document.querySelector('.icon-library-body').getAttribute('aria-busy')==='false'",
	);
	const catalog = await request(chooser.picker, { type: "icons" });
	assert(catalog._tag === "success");
	const pack = catalog.packs?.find((p) => p.name === "Lane artwork");
	assert(pack?.icons[0]);
	const icon = pack.icons[0];
	assert.deepEqual(icon.extraData, ["lane-metadata"]);
	pass("metadata survives real import and IPC");
	for (const query of ["Crimson", "warm-colour", "lane-metadata"]) {
		await input(chooser.picker, "#icon-search", query);
		await ready(
			chooser.picker,
			"document.querySelector('button[aria-label=\"Lane artwork\"]')?.getAttribute('aria-pressed')==='true' && document.querySelectorAll('.icon-library-cell').length===1",
		);
	}
	pass("mounted name/tag/extraData search and group fallback");
	await input(chooser.picker, "#icon-search", "no-icon-can-match-this");
	await ready(
		chooser.picker,
		"document.querySelector('.icon-library-empty')?.textContent.includes('No matching icons.')",
	);
	await button(chooser.picker, "Clear search");
	await ready(
		chooser.picker,
		"document.querySelectorAll('.icon-library-cell').length>20",
	);
	pass("zero-result clear action restores catalog");
	assert.equal(
		await evalIn(
			chooser.picker,
			"!!document.querySelector('button[aria-label=\"Local App Icons\"]')",
		),
		false,
	);
	for (let i = 0; i < 4; i++)
		await click(chooser.picker, 'button[aria-label="Zoom out"]');
	assert.equal(
		await evalIn(
			chooser.picker,
			"document.querySelector('input[aria-label=\"Icon size\"]').value",
		),
		"40",
	);
	assert.equal(
		await evalIn(
			chooser.picker,
			"document.querySelector('button[aria-label=\"Zoom out\"]').disabled",
		),
		true,
	);
	for (let i = 0; i < 10; i++)
		await click(chooser.picker, 'button[aria-label="Zoom in"]');
	assert.equal(
		await evalIn(
			chooser.picker,
			"document.querySelector('input[aria-label=\"Icon size\"]').value",
		),
		"120",
	);
	assert.equal(
		await evalIn(
			chooser.picker,
			"document.querySelector('button[aria-label=\"Zoom in\"]').disabled",
		),
		true,
	);
	pass("zoom steps, bounds and nonempty-local sidebar");
	await ready(
		chooser.picker,
		"document.querySelectorAll('.icon-library-cell img[src]').length>0",
	);
	const before = await evalIn(
		chooser.picker,
		"document.querySelectorAll('.icon-library-cell').length",
	);
	await evalIn(
		chooser.picker,
		"window.iconDisconnects=0;const disconnect=IntersectionObserver.prototype.disconnect;IntersectionObserver.prototype.disconnect=function(){window.iconDisconnects++;disconnect.call(this)};const grid=document.querySelector('.icon-library-grid');grid.scrollTop=grid.scrollHeight;grid.dispatchEvent(new Event('scroll'));true",
	);
	await ready(
		chooser.picker,
		`document.querySelectorAll('.icon-library-cell').length>${before}`,
	);
	await ready(
		chooser.picker,
		"!document.querySelector('.icon-library-cell img').hasAttribute('src')",
	);
	await input(chooser.picker, "#icon-search", "lane-metadata");
	await ready(
		chooser.picker,
		"document.querySelectorAll('.icon-library-cell').length===1 && window.iconDisconnects>0",
	);
	await ready(
		chooser.picker,
		"document.querySelector('.icon-library-cell img')?.naturalWidth>0",
	);
	pass("paging, offscreen release, reload and observer disposal");
	await evalIn(chooser.picker, "window.confirm=()=>false;true");
	await click(chooser.picker, 'button[aria-label="Uninstall Lane artwork"]');
	assert.equal(
		(await request(chooser.picker, { type: "icons" }))._tag,
		"success",
	);
	assert.equal(
		await evalIn(
			chooser.picker,
			"!!document.querySelector('button[aria-label=\"Lane artwork\"]')",
		),
		true,
	);
	await evalIn(chooser.picker, "window.confirm=()=>true;true");
	await click(chooser.picker, 'button[aria-label="Uninstall Lane artwork"]');
	await ready(
		chooser.picker,
		"document.querySelector('.icon-library-notice[role=status]')?.textContent.includes('Lane artwork')",
	);
	assert.equal(
		await evalIn(
			chooser.picker,
			"!!document.querySelector('button[aria-label=\"Lane artwork\"]')",
		),
		false,
	);
	pass("mounted pack confirmation cancel and success feedback");
	await chooser.close();

	// Actual native decoder and import owner, including duplicate feedback and errors.
	const png = await evalIn(
		win,
		"(()=>{const c=document.createElement('canvas');c.width=80;c.height=40;c.getContext('2d').fillRect(0,0,80,40);return c.toDataURL()})()",
	);
	assert(typeof png === "string");
	chooser = await open();
	const picture = join(directory, "owned-picture.png");
	await writeFile(picture, Buffer.from(png.split(",")[1] ?? "", "base64"));
	setPath(picture);
	await button(chooser.picker, "Select Picture");
	await ready(
		chooser.picker,
		"document.querySelector('button[aria-label=\"Local App Icons\"]')",
	);
	await button(chooser.picker, "Select Picture");
	await ready(
		chooser.picker,
		"document.querySelector('.icon-library-notice[role=status]')?.textContent.includes('Duplicate icon detected')",
	);
	const imported = await request(chooser.picker, { type: "icons" });
	assert(imported._tag === "success");
	const local = imported.packs?.find((p) => p.id === "local")?.icons[0];
	assert(local);
	assert.equal(imported.packs?.find((p) => p.id === "local")?.icons.length, 1);
	for (const [name, bytes] of [
		["invalid.png", Buffer.from("not an image")],
		["oversize.png", Buffer.alloc(5 * 1024 * 1024 + 1)],
		["unsafe.svg", Buffer.from('<svg onload="alert(1)"></svg>')],
	] as const) {
		const invalid = join(directory, name);
		await writeFile(invalid, bytes);
		setPath(invalid);
		await button(chooser.picker, "Select Picture");
		await ready(
			chooser.picker,
			"document.querySelector('.icon-library-notice[role=alert]') && document.querySelector('.icon-library-body').getAttribute('aria-busy')==='false'",
		);
		const after = await request(chooser.picker, { type: "icons" });
		assert(after._tag === "success");
		assert.deepEqual(after.packs, imported.packs);
	}
	pass("native PNG, duplicate reuse, malformed/size/unsafe SVG rejection");
	await click(chooser.picker, 'button[aria-label="Local App Icons"]');
	await evalIn(chooser.picker, "window.confirm=()=>false;true");
	await click(chooser.picker, 'button[aria-label="Delete owned-picture.png"]');
	assert.equal(
		await evalIn(
			chooser.picker,
			"document.querySelectorAll('.icon-library-cell').length",
		),
		1,
	);
	await evalIn(chooser.picker, "window.confirm=()=>true;true");
	const emptyLocalKey = Schema.encodeSync(ProfileKey)(
		createEmptyProfileKey("1,1"),
	);
	const localGuard = Schema.decodeUnknownSync(Profile)({
		id: "icons-local-guard",
		name: "Local guard",
		revision: 0,
		pages: [
			{
				id: "one",
				keys: [
					{
						...emptyLocalKey,
						childrenName: "text",
						config: {
							...emptyLocalKey.config,
							type: "text",
							display: true,
							icon: local.data,
						},
					},
				],
			},
		],
	});
	await profiles.runtime.runPromise(
		Effect.flatMap(ProfileRepository, (repo) =>
			repo.transact((env) =>
				Effect.succeed({ ...env, profiles: [...env.profiles, localGuard] }),
			),
		),
	);
	await click(chooser.picker, 'button[aria-label="Delete owned-picture.png"]');
	await ready(
		chooser.picker,
		"document.querySelector('.icon-library-notice[role=alert]')?.textContent.includes('currently in use')",
	);
	const protectedLocal = await request(chooser.picker, { type: "icons" });
	assert(
		protectedLocal._tag === "success" &&
			protectedLocal.packs
				?.find((pack) => pack.id === "local")
				?.icons.some((icon) => icon.id === local.id),
	);
	await profiles.runtime.runPromise(
		Effect.flatMap(ProfileRepository, (repo) =>
			repo.transact((env) =>
				Effect.succeed({
					...env,
					profiles: [
						env.profiles[0],
						...env.profiles
							.slice(1)
							.filter((profile) => profile.id !== localGuard.id),
					],
				}),
			),
		),
	);
	pass("mounted referenced custom-icon deletion fails and preserves content");
	await click(chooser.picker, 'button[aria-label="Delete owned-picture.png"]');
	await ready(
		chooser.picker,
		"document.querySelector('.icon-library-notice[role=status]')?.textContent.includes('owned-picture.png')",
	);
	pass("custom delete cancellation and localized success");
	for (const format of ["jpeg", "webp", "gif"]) {
		process.stdout.write(`Native format ${format}\n`);
		const data =
			format === "gif"
				? "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
				: await evalIn(
						win,
						`(()=>{const c=document.createElement('canvas');c.width=${format === "jpeg" ? 61 : 62};c.height=30;c.getContext('2d').fillRect(0,0,60,30);return c.toDataURL('image/${format}').split(',')[1]})()`,
					);
		assert(typeof data === "string");
		const file = join(directory, `native-picture.${format}`);
		await writeFile(file, Buffer.from(data, "base64"));
		setPath(file);
		await button(chooser.picker, "Select Picture");
		await ready(
			chooser.picker,
			"document.querySelector('.icon-library-body').getAttribute('aria-busy')==='false'",
		);
		const result = await request(chooser.picker, { type: "icons" });
		assert(
			result._tag === "success" &&
				result.packs
					?.find((p) => p.id === "local")
					?.icons.some((i) => i.name === `native-picture.${format}`),
		);
	}
	pass("native JPEG/GIF/WebP decoding");
	setPath(path);
	await button(chooser.picker, "Import Icon");
	await ready(
		chooser.picker,
		"document.querySelector('button[aria-label=\"Lane artwork\"]')",
	);
	await chooser.close();

	const empty = Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1"));
	const make = (
		type: string,
		source: string,
		size: readonly [number, number] = [1, 1],
	) => ({
		...empty,
		childrenName: type,
		config: {
			...empty.config,
			type,
			size,
			display: true,
			icon: source,
			title: { ...empty.config.title, text: type, display: true },
		},
	});
	const fixture = Schema.decodeUnknownSync(Profile)({
		id: "icons-lane",
		name: "Icons lane",
		revision: 0,
		pages: [
			{ id: "owned", keys: [make("text", `resource:${icon.id}`)] },
			{
				id: "save",
				keys: [
					{
						...make("hotkey", png),
						config: {
							...make("hotkey", png).config,
							actions: [{ type: "key", value: "a" }],
						},
					},
				],
			},
			{ id: "emoji", keys: [make("emoji", png)] },
			{ id: "emoji-wide", keys: [make("emoji", png, [4, 2])] },
			{ id: "game", keys: [make("gameMode", png)] },
			{ id: "game-wide", keys: [make("gameMode", png, [4, 2])] },
			{ id: "clock", keys: [make("dkDesktopClock", "")] },
			{ id: "meeting", keys: [make("meetingMinutes", "")] },
			{ id: "camera", keys: [make("cameraView", png)] },
			{ id: "mdi", keys: [make("text", "@mdi/svg/alarm.svg")] },
			{ id: "app-alias", keys: [make("text", "@/icon/application.svg")] },
			{ id: "unsafe-file", keys: [make("text", "file:///private/icon.svg")] },
			{
				id: "unsafe-url",
				keys: [make("text", "https://example.invalid/icon.svg")],
			},
			{
				id: "unsafe-data",
				keys: [
					make(
						"text",
						"data:image/svg+xml,%3Csvg%20onload%3D%22alert(1)%22%3E%3C%2Fsvg%3E",
					),
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
	await ready(
		win,
		"document.querySelector('#keys-profile option[value=\"icons-lane\"]')",
	);
	await select(win, "#keys-profile", fixture.id);
	await click(win, ".keys-cells button:first-child");
	await evalIn(
		win,
		"document.querySelector('.keys-preview').scrollIntoView();true",
	);
	await ready(
		win,
		"document.querySelector('.keys-preview .strip-tile-icon img')?.naturalWidth>0",
	);
	await evalIn(
		win,
		"document.querySelector('.key-selected-preview').scrollIntoView();true",
	);
	await ready(
		win,
		"document.querySelector('.key-selected-preview .strip-tile-icon img')?.naturalWidth>0",
	);
	pass("owned hash loads through GenericTile and selected card");
	for (const page of ["mdi", "app-alias"]) {
		await select(win, "#keys-page", page);
		await click(win, ".keys-cells button:first-child");
		await evalIn(
			win,
			"document.querySelector('.keys-preview').scrollIntoView();true",
		);
		await ready(
			win,
			"document.querySelector('.keys-preview .strip-tile-icon img')?.naturalWidth>0",
		);
	}
	for (const page of ["unsafe-file", "unsafe-url", "unsafe-data"]) {
		await select(win, "#keys-page", page);
		await click(win, ".keys-cells button:first-child");
		assert.equal(
			await evalIn(
				win,
				"document.querySelector('.keys-preview .strip-tile-icon img')",
			),
			null,
		);
	}
	pass("bundled MDI/app aliases and unsafe file/URL/SVG rejection");
	await select(win, "#keys-page", "emoji");
	await click(win, ".keys-cells button:first-child");
	const delayed = h.delays.pause("icons", "before");
	await select(win, "#keys-page", "owned");
	await delayed.entered;
	await select(win, "#keys-page", "emoji");
	await click(win, ".keys-cells button:first-child");
	delayed.release();
	await evalIn(
		win,
		"document.querySelector('.keys-preview').scrollIntoView();true",
	);
	await ready(
		win,
		`document.querySelector('.keys-preview .strip-tile-icon img')?.getAttribute('src')===${JSON.stringify(png)}`,
	);
	pass("dataURL-to-owned reload ignores a late result after a source change");
	const protectedChooser = await open();
	await input(protectedChooser.picker, "#icon-search", "lane-metadata");
	await ready(
		protectedChooser.picker,
		"document.querySelector('button[aria-label=\"Uninstall Lane artwork\"]')",
	);
	await evalIn(protectedChooser.picker, "window.confirm=()=>true;true");
	await click(
		protectedChooser.picker,
		'button[aria-label="Uninstall Lane artwork"]',
	);
	await ready(
		protectedChooser.picker,
		"document.querySelector('.icon-library-notice[role=alert]')?.textContent.includes('currently in use')",
	);
	await protectedChooser.close();
	pass("mounted referenced-hash pack deletion fails without changing storage");
	for (const page of ["emoji", "emoji-wide", "game", "game-wide", "camera"]) {
		await select(win, "#keys-page", page);
		await click(win, ".keys-cells button:first-child");
		await evalIn(
			win,
			"document.querySelector('.keys-preview').scrollIntoView();true",
		);
		await ready(
			win,
			"document.querySelector('.keys-preview .strip-tile-icon img')?.naturalWidth>0",
		);
		const result = await evalIn(
			win,
			`(()=>{const tile=document.querySelector('.keys-preview .strip-tile');const art=tile.querySelector('.strip-tile-icon');const card=document.querySelector('.key-selected-preview [data-preview-width]');const slot=tile.closest('.strip-slot[data-state=tile]');return {w:parseFloat(tile.style.width)||slot.clientWidth,h:parseFloat(tile.style.height)||slot.clientHeight,aw:parseFloat(art.style.width),ah:parseFloat(art.style.height),cw:Number(card.dataset.previewWidth),ch:Number(card.dataset.previewHeight),frameW:document.querySelector('.key-selected-preview-frame').clientWidth}})()`,
		);
		assert(
			result &&
				typeof result === "object" &&
				"w" in result &&
				"h" in result &&
				"aw" in result &&
				"ah" in result &&
				"cw" in result &&
				"ch" in result &&
				"frameW" in result,
		);
		assert(
			typeof result.w === "number" &&
				typeof result.h === "number" &&
				typeof result.aw === "number" &&
				typeof result.ah === "number" &&
				typeof result.cw === "number" &&
				typeof result.ch === "number" &&
				typeof result.frameW === "number",
		);
		if (page.startsWith("emoji"))
			assert.equal(result.aw, Math.floor(Math.min(result.w, result.h) * 0.77));
		if (page.startsWith("game")) {
			assert.equal(result.aw, Math.floor(result.w * 0.95));
			assert.equal(result.ah, Math.floor(result.h * 0.95));
		}
		assert(result.cw <= result.frameW);
		if (page === "camera") assert.equal(result.cw / result.ch, 1.5);
	}
	pass("StripScreen emoji 1x1/4x2, game .95 and bounded camera 3:2 preview");
	await select(win, "#keys-page", "game");
	await click(win, ".keys-cells button:first-child");
	await evalIn(
		win,
		"document.querySelector('.keys-preview').scrollIntoView();true",
	);
	const apps = await request(win, { type: "application-icons" });
	assert(apps._tag === "success");
	const app = apps.packs
		?.flatMap((pack) => pack.icons)
		.find((icon) => icon.extraData?.[0]);
	assert(
		app?.extraData?.[0],
		"Host needs one extractable installed app for game artwork acceptance",
	);
	const slotBefore = await evalIn(
		win,
		"(()=>{const node=document.querySelector('.keys-preview .strip-slot[data-state=tile]');return [node.style.left,node.style.top,node.style.width,node.style.height]})()",
	);
	const resolveForeground = foregroundArtwork(async () => ({
		id: "applications",
		name: "Apps",
		icons: [app],
	}));
	win.webContents.send(
		MONITOR_ARTWORK,
		await resolveForeground({
			metrics: { sampledAt: 0, samples: [] },
			foreground: {
				state: "available",
				collectedAt: 1,
				window: { id: "fixture", path: app.extraData[0] },
			},
		}),
	);
	await ready(
		win,
		`document.querySelector('.keys-preview .strip-tile-icon img')?.getAttribute('src')===${JSON.stringify(app.data)}`,
	);
	assert.deepEqual(
		await evalIn(
			win,
			"(()=>{const node=document.querySelector('.keys-preview .strip-slot[data-state=tile]');return [node.style.left,node.style.top,node.style.width,node.style.height]})()",
		),
		slotBefore,
	);
	const catalogs = h.delays.requests.filter(
		(request) => request.type === "application-icons",
	).length;
	for (let sample = 1; sample <= 10; sample++)
		win.webContents.send("monitor:metrics", { sampledAt: sample, samples: [] });
	await evalIn(
		win,
		"new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
	);
	assert.equal(
		h.delays.requests.filter((request) => request.type === "application-icons")
			.length,
		catalogs,
	);
	assert.equal(
		await evalIn(
			win,
			"document.querySelector('.keys-preview .strip-tile-icon img').getAttribute('src')",
		),
		app.data,
	);
	win.webContents.send(
		MONITOR_ARTWORK,
		await resolveForeground({
			metrics: { sampledAt: 0, samples: [] },
			foreground: { state: "permission-denied", collectedAt: 2 },
		}),
	);
	await ready(
		win,
		`document.querySelector('.keys-preview .strip-tile-icon img')?.getAttribute('src')===${JSON.stringify(png)}`,
	);
	pass(
		"foreground-app artwork uses installed owner, retains hit targets and falls back on permission denial",
	);
	await select(win, "#keys-page", "clock");
	await click(win, ".keys-cells button:first-child");
	await ready(
		win,
		"document.querySelector('.key-selected-preview .oq-clock') && !document.querySelector('button[aria-label=\"Next clock theme\"]').disabled",
	);
	const theme = await evalIn(
		win,
		"document.querySelector('.key-selected-preview .oq-clock').dataset.theme",
	);
	await click(win, 'button[aria-label="Next clock theme"]');
	await ready(
		win,
		`document.querySelector('.key-selected-preview .oq-clock')?.dataset.theme!==${JSON.stringify(theme)} && document.querySelector('button[aria-label="Next clock theme"]')?.disabled===false`,
	);
	await click(win, 'button[aria-label="Previous clock theme"]');
	await ready(
		win,
		`document.querySelector('.key-selected-preview .oq-clock')?.dataset.theme===${JSON.stringify(theme)} && document.querySelector('button[aria-label="Previous clock theme"]')?.disabled===false`,
	);
	pass("selected clock arrows change and restore persisted theme");
	const delayedClock = h.delays.pause("clock:setTheme", "after");
	await click(win, 'button[aria-label="Next clock theme"]');
	await delayedClock.entered;
	await select(win, "#keys-page", "save");
	await click(win, ".keys-cells button:first-child");
	await input(win, "#key-title", "Retained draft");
	delayedClock.release();
	await new Promise((resolve) => setTimeout(resolve, 250));
	assert.equal(
		await evalIn(win, "document.querySelector('#keys-page').value"),
		"save",
	);
	assert.equal(
		await evalIn(win, "document.querySelector('#key-title').value"),
		"Retained draft",
	);
	pass("late clock completion preserves the new editor selection and draft");
	await select(win, "#keys-page", "meeting");
	await click(win, ".keys-cells button:first-child");
	await ready(win, "document.querySelector('.key-selected-preview button')");
	assert.equal(
		await evalIn(
			win,
			`(() => {
 const tile=document.querySelector('.key-selected-preview [data-preview-width]');
 const action=tile.querySelector('button');
 for (const side of ['before','after']) {
  const anchor=document.createElement('button'); anchor.dataset.previewTest=side;
  if(side==='before')tile.before(anchor);else tile.after(anchor);
 }
 const before=document.querySelector('[data-preview-test=before]'); before.focus();
 action.addEventListener('click',()=>{action.dataset.activations='1'});
 action.focus();
 return tile.inert && document.activeElement===before;
 })()`,
		),
		true,
	);
	win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab" });
	win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Tab" });
	await ready(
		win,
		"document.activeElement===document.querySelector('[data-preview-test=after]')",
	);
	win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
	win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Return" });
	assert.equal(
		await evalIn(
			win,
			`(() => {
 const action=document.querySelector('.key-selected-preview [inert] button');
 const untouched=!action.dataset.activations;
 document.querySelectorAll('[data-preview-test]').forEach(el=>el.remove());
 return untouched;
 })()`,
		),
		true,
	);
	pass("selected meeting preview rejects focus and Tab/Enter activation");

	await select(win, "#keys-page", "save");
	await click(win, ".keys-cells button:first-child");
	await button(win, "Icon Library");
	const savePicker = await h.iconPicker(win);
	await button(win, "Save");
	await ready(
		win,
		"document.body.innerText.includes('Saved successfully') && document.querySelector('.key-editor')?.getAttribute('aria-busy')==='false'",
	);
	await new Promise<void>((resolve, reject) => {
		if (savePicker.isDestroyed()) {
			resolve();
			return;
		}
		const timer = setTimeout(
			() => reject(new Error("Save picker did not close")),
			8000,
		);
		savePicker.once("closed", () => {
			clearTimeout(timer);
			resolve();
		});
	});
	assert(savePicker.isDestroyed(), "Save must close the mounted editor picker");
	await button(win, "Icon Library");
	const entrancePicker = await h.iconPicker(win);
	await click(win, '[data-nav-page="profiles"]');
	assert(
		entrancePicker.isDestroyed(),
		"Leaving Keys must cancel its mounted picker",
	);
	await button(win, "Keys");
	await select(win, "#keys-profile", fixture.id);
	await click(win, ".keys-cells button:first-child");
	pass("mounted Save and entrance navigation cancel the owner picker");

	// Pending native pick is observable before main returns pixels and destroys its child.
	chooser = await open();
	await input(chooser.picker, "#icon-search", "lane-metadata");
	await ready(
		chooser.picker,
		"document.querySelectorAll('.icon-library-cell').length===1",
	);
	const pause = h.delays.pause("pick-icon", "before");
	await click(chooser.picker, ".icon-library-cell > button");
	await pause.entered;
	assert.equal(
		await evalIn(
			chooser.picker,
			"document.querySelector('.icon-library-cell > button').getAttribute('aria-pressed')==='true' && document.querySelector('.icon-library-cell > button').disabled",
		),
		true,
	);
	assert.equal(
		await evalIn(
			chooser.picker,
			"getComputedStyle(document.querySelector('.icon-library-cell > button')).opacity",
		),
		"1",
	);
	assert.equal(
		await evalIn(
			chooser.picker,
			"getComputedStyle(document.querySelector('.icon-library-cell > button')).backgroundColor",
		),
		"rgba(95, 202, 181, 0.14)",
	);
	await evalIn(
		chooser.picker,
		"new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))",
	);
	await snapshot(chooser.picker, "icons-selected-cell");
	pause.release();
	const picked = await chooser.pending;
	assert(picked._tag === "success" && picked.icon);
	const pickedBytes = Buffer.from(picked.icon.split(",")[1] ?? "", "base64");
	assert.equal(pickedBytes.readUInt32BE(16), 170);
	assert.equal(pickedBytes.readUInt32BE(20), 170);
	pass("selected-cell pending feedback with one portable 170px pick");
	for (const locale of ["en", "de"] as const) {
		chooser = await open(locale);
		await ready(
			chooser.picker,
			"document.querySelector('.icon-library-body').getAttribute('aria-busy')==='false'",
		);
		await snapshot(chooser.picker, `icons-picker-${locale}`);
		assert.equal(
			await evalIn(
				chooser.picker,
				"getComputedStyle(document.querySelector('.icon-picker-surface')).backgroundColor",
			),
			"rgb(9, 9, 11)",
		);
		assert.equal(
			await evalIn(
				chooser.picker,
				"getComputedStyle(document.querySelector('#icon-search')).color",
			),
			"rgb(244, 244, 245)",
		);
		await evalIn(
			chooser.picker,
			"document.querySelector('#icon-search').focus();true",
		);
		const outline = await evalIn(
			chooser.picker,
			"parseFloat(getComputedStyle(document.querySelector('#icon-search')).outlineWidth)",
		);
		assert(typeof outline === "number" && outline >= 2);
		await chooser.close();
	}
	pass("EN/DE screenshots and computed dark palette/focus readability");
	await select(win, "#keys-page", "clock");
	await click(win, ".keys-cells button:first-child");
	await ready(win, "document.querySelector('.key-selected-preview .oq-clock')");
	await evalIn(
		win,
		"document.querySelector('.key-selected-preview').scrollIntoView({block:'center'});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))",
	);
	await snapshot(win, "icons-selected-preview");

	// Drive real manager rows using the same public snapshot event as main.
	await click(win, '[data-nav-page="profiles"]');
	await ready(win, "document.querySelector('.profiles-manager')");
	const reply = Schema.decodeUnknownSync(ProfileReplySchema)(
		await evalIn(
			win,
			"window.quakeProfileManager.request({type:'read',locale:'en'})",
		),
	);
	assert(reply._tag === "success");
	const base = reply.view;
	const template = base.envelope.profiles.at(-1);
	assert(template);
	const fake = {
		...template,
		id: "icons-thumb-row",
		name: "Thumbnail states",
	};
	const send = async (source: string, running: boolean, changed = false) => {
		win.webContents.send(PROFILE_SNAPSHOT, {
			...base,
			envelope: {
				...base.envelope,
				profiles: [
					...base.envelope.profiles,
					{
						...fake,
						revision: changed ? 1 : 0,
						pages: changed
							? fake.pages.map((page) => ({
									...page,
									keys: page.keys.map((key) => ({
										...key,
										config: {
											...key.config,
											title: { ...key.config.title, text: "changed" },
										},
									})),
								}))
							: fake.pages,
					},
				],
			},
			thumbnails: source ? { "icons-thumb-row": source } : {},
			progress: { running, done: 0, total: 1, failed: 0 },
		});
	};
	const row = '.profile-thumbnail-cell[data-profile-id="icons-thumb-row"]';
	await send("", false);
	await ready(win, `document.querySelector('${row}')?.dataset.state==='empty'`);
	await send("", true);
	await ready(
		win,
		`document.querySelector('${row}')?.dataset.state==='generating' && document.querySelector('${row} button').disabled`,
	);
	await send(png, false);
	await ready(win, `document.querySelector('${row}')?.dataset.state==='ready'`);
	await send("", false, true);
	await ready(win, `document.querySelector('${row}')?.dataset.state==='stale'`);
	assert.equal(
		await evalIn(
			win,
			`getComputedStyle(document.querySelector('${row} img')).opacity`,
		),
		"0.45",
	);
	await send(png, true);
	await ready(
		win,
		`document.querySelector('${row}')?.dataset.state==='updating' && document.querySelector('${row} button').disabled`,
	);
	await send(png, false);
	await evalIn(
		win,
		`document.querySelector('${row} img').dispatchEvent(new Event('error'));true`,
	);
	await ready(
		win,
		`document.querySelector('${row}')?.dataset.state==='failed' && document.querySelector('${row} [role=status]')?.textContent.length>1`,
	);
	await snapshot(win, "icons-thumbnail-states");
	pass(
		"mounted thumbnail empty/ready/stale/generating/updating/failed and batch lock",
	);
	process.stdout.write(
		`Icons lane native acceptance: ${checks} groups passed. Hardware and live foreground-app artwork remain unverified.\n`,
	);
}
