/** PR37 regressions through the mounted picker/editor and durable native stores. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { nativeImage } from "electron";
import {
	createEmptyProfileKey,
	Profile,
	ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { ProfileRepository } from "../../../../../packages/device/src/profiles/profile-repository.js";
import { KeyReply, type KeyRequest } from "../../shared/key-library";
import { iconZip } from "../test/icon-pack-fixtures";
import type { Harness } from "./smoke-editor";

export async function verifyIconReview(
	h: Harness,
	directory: string,
	setPath: (path: string) => void,
	probe?: string,
): Promise<void> {
	const {
		manager,
		profiles,
		evalIn,
		ready,
		click,
		button,
		select,
		input,
		snapshot,
		iconPicker,
	} = h;
	const request = async (win: typeof manager, command: KeyRequest) =>
		Schema.decodeUnknownSync(KeyReply)(
			await evalIn(
				win,
				`window.quakeKeyLibrary.request(${JSON.stringify(command)})`,
			),
		);
	const owned = async (command: KeyRequest) => {
		const token = `review-${Date.now()}`;
		const pending = request(manager, {
			type: "open-icons",
			token,
			locale: "en",
		});
		try {
			return await request(await iconPicker(manager), command);
		} finally {
			await request(manager, { type: "cancel-icons", token });
			await pending;
		}
	};
	const path = join(directory, "review-source.zip");
	setPath(path);
	await writeFile(
		path,
		iconZip([
			{
				name: "manifest.json",
				data: JSON.stringify({ Name: "Review source" }),
			},
			{
				name: "icons.json",
				data: JSON.stringify([
					{ path: "source.svg", name: "Source", tags: [] },
				]),
			},
			{
				name: "icons/source.svg",
				data: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="red"/></svg>',
			},
		]),
	);
	const imported = await owned({ type: "import-pack" });
	assert(imported._tag === "success");
	const pack = imported.packs?.find((p) => p.name === "Review source");
	assert(pack?.icons[0]);
	const source = pack.icons[0].data;
	const pixels = await evalIn(
		manager,
		"(()=>{const c=document.createElement('canvas');c.width=c.height=170;c.getContext('2d').fillRect(0,0,170,170);return c.toDataURL()})()",
	);
	assert(typeof pixels === "string");
	const empty = Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1"));
	const fixture = Schema.decodeUnknownSync(Profile)({
		id: "icon-review",
		name: "Icon review",
		revision: 0,
		pages: [
			{
				id: "one",
				keys: [false, true].map((primaryDefault, i) => ({
					...empty,
					keyCode: `1,${i + 1}`,
					childrenName: "hotkeySwitch",
					config: {
						...empty.config,
						type: "hotkeySwitch",
						display: true,
						icon: pixels,
						alterIcon: pixels,
						actions: [
							{ type: "key", value: "a" },
							{ type: "key", value: "b" },
						],
						compatibility: {
							iconSource: source,
							alternateIconSource: source,
							...(primaryDefault ? { defaultIcon: "" } : {}),
						},
					},
				})),
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
		manager,
		`document.querySelector('#keys-profile option[value="icon-review"]')`,
	);
	await select(manager, "#keys-profile", fixture.id);
	await click(manager, ".keys-cells button:first-child");
	await ready(
		manager,
		"document.querySelector('#key-function')?.value === 'hotkeySwitch'",
	);
	const save = async () => {
		await button(manager, "Save");
		await ready(
			manager,
			"document.querySelector('.key-editor')?.getAttribute('aria-busy')==='false' && document.body.innerText.includes('Saved successfully')",
		);
	};
	if (!probe || probe === "icon-review-reset") {
		for (const code of ["1,1", "1,2"]) {
			await click(
				manager,
				`.keys-cells button:nth-child(${code === "1,1" ? 1 : 2})`,
			);
			await click(manager, 'button[aria-label="Reset icon to default"]');
			await save();
			const result = await request(manager, { type: "read", locale: "en" });
			assert(result._tag === "success");
			const key = result.envelope?.profiles
				.find((p) => p.id === fixture.id)
				?.pages[0]?.keys.find((k) => k.keyCode === code);
			assert(key);
			assert.equal(key.config.icon, code === "1,1" ? pixels : "");
			assert.equal(key.config.alterIcon, pixels);
			assert.equal(
				key.config.compatibility?.iconSource,
				code === "1,1" ? source : "",
			);
			assert.equal(key.config.compatibility?.alternateIconSource, source);
			assert.equal(
				(await owned({ type: "remove-pack", id: pack.id }))._tag,
				"rejected",
			);
		}
		await snapshot(manager, "reset-source-protection");
		process.stdout.write(
			"Icon reset source PASS: no-default and partial-default reset/Save retain per-state pack protection.\n",
		);
	}
	if (!probe || probe === "icon-review-paging") {
		await button(manager, "Icon Library");
		const chooser = await iconPicker(manager);
		chooser.setContentSize(900, 1000);
		for (let i = 0; i < 4; i++)
			await click(chooser, 'button[aria-label="Zoom out"]');
		await ready(
			chooser,
			"document.querySelector('input[aria-label=\"Icon size\"]').value==='40'",
		);
		await ready(
			chooser,
			"(()=>{const g=document.querySelector('.icon-library-grid');return g?.scrollHeight>g?.clientHeight && g.children.length>Number(g.dataset.batch)})()",
		);
		const count = await evalIn(
			chooser,
			"document.querySelectorAll('.icon-library-cell').length",
		);
		assert(typeof count === "number");
		await evalIn(
			chooser,
			"(()=>{const g=document.querySelector('.icon-library-grid');g.scrollTop=g.scrollHeight;g.dispatchEvent(new Event('scroll'))})()",
		);
		await ready(
			chooser,
			`document.querySelectorAll('.icon-library-cell').length>${count}`,
		);
		await input(chooser, "#icon-search", "alarm");
		await ready(
			chooser,
			"document.querySelectorAll('.icon-library-cell').length>0 && document.querySelectorAll('.icon-library-cell').length<170",
		);
		await input(chooser, "#icon-search", "");
		await ready(
			chooser,
			"(()=>{const g=document.querySelector('.icon-library-grid');return g.children.length>Number(g.dataset.batch)&&g.scrollHeight>g.clientHeight})()",
		);
		chooser.setContentSize(900, 1600);
		await ready(
			chooser,
			"(()=>{const g=document.querySelector('.icon-library-grid');return g.scrollHeight>g.clientHeight})()",
		);
		await snapshot(chooser, "tall-picker-scrollable");
		await click(chooser, 'button[aria-label="Close Icon Library"]');
		process.stdout.write(
			"Icon viewport PASS: tall 900x1000/1600 zoom40 batches fill, scroll and refill after search.\n",
		);
	}
	if (!probe || probe === "icon-review-raster") {
		await click(manager, ".keys-cells button:nth-child(2)");
		const imageUrl = await evalIn(
			manager,
			`(()=>{const c=document.createElement('canvas');c.width=2400;c.height=1800;const x=c.getContext('2d');const p=x.createImageData(c.width,c.height);let seed=42037;for(let i=0;i<p.data.length;i+=4){for(let j=0;j<3;j++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;p.data[i+j]=seed>>>24;}p.data[i+3]=255;}x.putImageData(p,0,0);return c.toDataURL('image/jpeg',0.85)})()`,
		);
		assert(typeof imageUrl === "string");
		const bytes = Buffer.from(imageUrl.split(",")[1] ?? "", "base64");
		assert(bytes.length < 5 * 1024 * 1024);
		assert(
			nativeImage.createFromBuffer(bytes).toDataURL().length > 8 * 1024 * 1024,
		);
		const rasterPath = join(directory, "high-detail.jpg");
		await writeFile(rasterPath, bytes);
		setPath(rasterPath);
		const result = await owned({ type: "import-icon" });
		assert(result._tag === "success");
		const local = result.packs
			?.find((p) => p.id === "local")
			?.icons.find((i) => i.name.includes("high-detail"));
		assert(local);
		assert(local.data.length <= 8 * 1024 * 1024);
		const size = nativeImage.createFromDataURL(local.data).getSize();
		assert.equal(size.width * 3, size.height * 4);
		await button(manager, "Icon Library");
		const chooser = await iconPicker(manager);
		await click(chooser, 'button[aria-label="Local App Icons"]');
		await click(
			chooser,
			`button[aria-label=${JSON.stringify(`Select ${local.name}`)}]`,
		);
		await save();
		const saved = await request(manager, { type: "read", locale: "en" });
		assert(saved._tag === "success");
		const key = saved.envelope?.profiles
			.find((p) => p.id === fixture.id)
			?.pages[0]?.keys.find((k) => k.keyCode === "1,2");
		assert(key);
		assert.deepEqual(nativeImage.createFromDataURL(key.config.icon).getSize(), {
			width: 170,
			height: 170,
		});
		assert.equal(key.config.compatibility?.iconSource, local.data);
		assert.equal(
			(await owned({ type: "remove-icon", id: local.id }))._tag,
			"rejected",
		);
		await snapshot(manager, "high-detail-raster-saved");
		process.stdout.write(
			"Icon raster PASS: compressed input expands beyond8MiB, normalizes, selects and saves portable170 with source protection.\n",
		);
	}
	await profiles.runtime.runPromise(
		Effect.flatMap(ProfileRepository, (repo) =>
			repo.transact((env) =>
				Effect.succeed({
					...env,
					profiles: [
						env.profiles[0],
						...env.profiles.slice(1).filter((p) => p.id !== fixture.id),
					],
				}),
			),
		),
	);
}
