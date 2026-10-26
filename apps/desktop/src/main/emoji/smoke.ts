import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { app, BrowserWindow } from "electron";
import {
	defaultMotion,
	motionPresets,
} from "../../renderer/src/management/emoji/composer";
import { decodeGif } from "../../shared/gif";
import { videoToGif } from "./video-to-gif";

assert.equal(process.env.OPEN_QUAKE_MOCK_DEVICE, "1");
const directory = mkdtempSync(join(tmpdir(), "oq-emoji-smoke-"));
app.setPath("userData", directory);
app.on("window-all-closed", () => {});
const output = process.argv[2] ?? "";
const video = process.argv[3] ?? "";
assert(output && video, "Supply screenshot directory and synthetic silent MP4");
const settle = () => new Promise<void>((done) => setTimeout(done, 60));
async function smoke() {
	await app.whenReady();
	await mkdir(output, { recursive: true });
	const win = new BrowserWindow({
		show: false,
		focusable: false,
		enableLargerThanScreen: true,
		useContentSize: true,
		width: 1320,
		height: 1000,
		webPreferences: {
			sandbox: true,
			contextIsolation: true,
			backgroundThrottling: false,
		},
	});
	win.webContents.setAudioMuted(true);
	win.webContents.on("console-message", (_event, level, message) => {
		if (level === 3) process.stderr.write(`${message}\n`);
	});
	const js = (code: string): Promise<unknown> =>
		win.webContents.executeJavaScript(code);
	const wait = async (condition: string) => {
		const end = Date.now() + 8000;
		while (!(await js(`Boolean(${condition})`))) {
			if (Date.now() >= end) {
				await writeFile(
					join(output, "failure.png"),
					(await win.webContents.capturePage()).toPNG(),
				);
				throw Error(
					`Timed out: ${condition}\n${await js("document.body.innerText")}`,
				);
			}
			await settle();
		}
	};
	const click = async (text: string, within = "document") => {
		await js(
			`Array.from(${within}.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click();null;`,
		);
		await settle();
	};
	const input = async (selector: string, value: string) => {
		await js(
			`(()=>{const el=document.querySelector(${JSON.stringify(selector)}); const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})();null;`,
		);
		await settle();
	};
	const screenshot = async (name: string) => {
		await js("window.scrollTo(0,0);document.fonts.ready");
		await js(
			"new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
		);
		await writeFile(
			join(output, `${name}.png`),
			(await win.webContents.capturePage()).toPNG(),
		);
	};
	try {
		await win.loadFile(resolve("out/emoji-smoke/renderer/smoke.html"));
		await wait(
			"document.querySelector('.emoji-composer textarea') && document.querySelector('.emoji-assets img')?.naturalWidth > 0",
		);
		assert.equal(
			await js("document.querySelector('.emoji-composer textarea').value"),
			defaultMotion("en"),
		);
		assert.equal(
			await js("document.querySelectorAll('.emoji-assets button').length"),
			16,
		);
		await js(
			"document.querySelector('.emoji-assets').dispatchEvent(new WheelEvent('wheel',{deltaY:200,bubbles:true}));null;",
		);
		assert.equal(
			await js("document.querySelector('.emoji-assets').scrollLeft > 0"),
			true,
		);
		await js(
			"document.querySelector('.emoji-assets button:last-child').click();null;",
		);
		await wait(
			"document.querySelector('.emoji-assets button:last-child').getAttribute('aria-selected') === 'true'",
		);
		await js(
			"document.querySelector('.emoji-assets button').click();document.querySelector('.emoji-assets').scrollLeft=0;null;",
		);
		await settle();
		await js("window.quakeLocale.set('de')");
		await wait(
			`document.querySelector('.emoji-composer textarea').value === ${JSON.stringify(defaultMotion("de"))}`,
		);
		for (const preset of motionPresets("de")) {
			await click(preset);
			assert.equal(
				await js("document.querySelector('.emoji-composer textarea').value"),
				preset,
			);
		}
		await input(".emoji-composer textarea", "Mein eigener Tanz");
		await js("window.quakeLocale.set('en')");
		await settle();
		assert.equal(
			await js("document.querySelector('.emoji-composer textarea').value"),
			"Mein eigener Tanz",
		);
		await input(".emoji-composer textarea", "");
		assert.equal(
			await js(
				"Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Generate Motion Emoji').disabled",
			),
			true,
		);
		await input(".emoji-composer textarea", "Wave once");
		await click("Generate from template");
		await input(".mc-dialog textarea", "🙂".repeat(250));
		assert.equal(
			await js(
				"Array.from(document.querySelectorAll('.mc-dialog button')).find(b=>b.textContent.trim()==='Generate Emoji').disabled",
			),
			false,
		);
		await input(".mc-dialog textarea", "🙂".repeat(251));
		assert.equal(
			await js(
				"Array.from(document.querySelectorAll('.mc-dialog button')).find(b=>b.textContent.trim()==='Generate Emoji').disabled",
			),
			true,
		);
		await click("Cancel", "document.querySelector('.mc-dialog')");
		assert.equal(
			await js(
				"window.laneTest.emojiRequests.filter(r=>r.type==='generate').length",
			),
			0,
		);
		await input(
			'.emoji-fields input[placeholder="e.g. Go for it!"]',
			"My text",
		);
		await click("Generate Motion Emoji");
		await wait("document.querySelector('.emoji-draft')");
		assert.equal(
			await js("window.laneTest.store().items[0].caption.text"),
			"My text",
		);
		assert.equal(
			await js(
				"document.querySelector('.emoji-draft [role=option]').getAttribute('aria-selected')",
			),
			"true",
		);
		await click("Edit", "document.querySelector('.emoji-draft')");
		await wait("document.querySelector('.mc-dialog input[type=text]')");
		await input(".mc-dialog input[type=text]", "Dancer");
		await click("Suggest caption");
		assert.equal(
			await js("document.querySelector('.mc-dialog input:not([type])').value"),
			"My text",
		);
		await click("Use suggestion");
		assert.equal(
			await js("document.querySelector('.mc-dialog input:not([type])').value"),
			"Let's go!",
		);
		await js(
			"(()=>{const el=document.querySelector('.mc-dialog select');el.value='2';el.dispatchEvent(new Event('change',{bubbles:true}));})();",
		);
		await click("Save", "document.querySelector('.mc-dialog')");
		await wait("!document.querySelector('.mc-dialog')");
		assert.equal(await js("window.laneTest.store().items[0].mode"), 2);
		await click("Add to Pack");
		await click("New Package", "document.querySelector('.mc-dialog')");
		await wait("document.querySelector('.emoji-pack input')");
		await input(".emoji-pack input", "Dance");
		await js(
			"document.querySelector('.emoji-pack input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));null;",
		);
		await settle();
		assert.equal(
			await js(
				"document.querySelector('.emoji-draft [role=option]').getAttribute('aria-selected')",
			),
			"true",
		);
		await click("Add to Pack");
		await wait(
			"document.querySelector('.emoji-pack-slot img')?.naturalWidth > 0",
		);
		assert.equal(
			await js("window.laneTest.store().packages[0].emojiIds[0]"),
			await js("window.laneTest.store().items[0].id"),
		);
		await js(
			"document.querySelector('.emoji-pack > button').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));null;",
		);
		await wait("document.querySelector('.emoji-pack input')");
		await input(".emoji-pack input", "Cancelled");
		await js(
			"document.querySelector('.emoji-pack input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));null;",
		);
		await settle();
		assert.equal(await js("window.laneTest.store().packages[0].name"), "Dance");
		await js(
			"document.querySelector('.emoji-pack > button').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));null;",
		);
		await wait("document.querySelector('.emoji-pack input')");
		await input(".emoji-pack input", "Dance two");
		await js(
			"document.querySelector('.emoji-pack input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));null;",
		);
		await wait("window.laneTest.store().packages[0].name === 'Dance two'");
		await screenshot("emoji-en");
		await js("window.quakeLocale.set('de')");
		await settle();
		await screenshot("emoji-de");
		await js("window.laneTest.show('shortcuts')");
		await wait("document.querySelector('form input[placeholder]')");
		await input("form input[placeholder]", "Design actions");
		await click("Generate Shortcuts");
		await wait("document.querySelectorAll('tbody tr').length === 4");
		assert.equal(
			await js(
				"document.querySelectorAll('tbody input[type=checkbox]:checked').length",
			),
			3,
		);
		assert.equal(
			await js("document.querySelector('thead input').indeterminate"),
			true,
		);
		assert.equal(await js("document.querySelectorAll('tbody img').length"), 3);
		assert.equal(
			await js(
				"document.querySelectorAll('tbody [aria-label=\"Application icon unavailable\"]').length",
			),
			1,
		);
		await js("document.querySelector('thead input').click();null;");
		await settle();
		assert.equal(
			await js(
				"document.querySelectorAll('tbody input[type=checkbox]:checked').length",
			),
			4,
		);
		await js("document.querySelector('thead input').click();null;");
		await settle();
		await js(
			"document.querySelector('tbody input[type=checkbox]').click();null;",
		);
		await settle();
		await click("Delete selected");
		assert.equal(
			await js("window.laneTest.confirmations.at(-1)"),
			"Delete 1 selected shortcut(s)?",
		);
		assert.equal(await js("document.querySelectorAll('tbody tr').length"), 4);
		await js("window.laneTest.confirm(true)");
		await click("Delete selected");
		assert.equal(await js("document.querySelectorAll('tbody tr').length"), 3);
		await js(
			"document.querySelector('tbody button[aria-label^=\"Edit shortcut\"]').click();null;",
		);
		await settle();
		await input("tbody td:nth-child(4) input", "Ctrl + C");
		await js(
			"document.querySelector('tbody td:nth-child(4) input').dispatchEvent(new FocusEvent('focusout',{bubbles:true}));null;",
		);
		await settle();
		assert.equal(
			await js(
				"Array.from(document.querySelectorAll('tbody .mc-badge')).filter(el=>el.textContent==='Conflict').length",
			),
			2,
		);
		await click("Reset", "document.querySelector('tbody tr')");
		assert.equal(
			await js(
				"Array.from(document.querySelectorAll('tbody .mc-badge')).filter(el=>el.textContent==='Conflict').length",
			),
			0,
		);
		await js("document.querySelector('thead input').click();null;");
		await settle();
		await click("Add to shortcut pack");
		await wait(
			"window.laneTest.libraries().length === 1 && document.querySelector('aside article')",
		);
		await js(
			"window.laneTest.failSave(true);document.querySelector('tbody button[aria-label^=\"Edit shortcut\"]').click();null;",
		);
		await settle();
		await input("tbody td:nth-child(4) input", "Ctrl + Z");
		await js(
			"document.querySelector('tbody td:nth-child(4) input').dispatchEvent(new FocusEvent('focusout',{bubbles:true}));null;",
		);
		await wait("document.querySelector('[role=alert]')");
		assert.equal(
			await js(
				"document.querySelector('tbody td:nth-child(4)').textContent.includes('B')",
			),
			true,
		);
		assert.equal(
			await js("window.laneTest.libraries()[0].rows[0].chord"),
			"control+b",
		);
		await input("tbody input[aria-label^=Name]", "Unsaved label");
		await js(
			"document.querySelector('tbody input[aria-label^=Name]').dispatchEvent(new FocusEvent('focusout',{bubbles:true}));null;",
		);
		await settle();
		assert.equal(
			await js("document.querySelector('tbody input[aria-label^=Name]').value"),
			"Action 2",
		);
		await js(
			"window.laneTest.failSave(false);document.querySelector('aside article').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));null;",
		);
		await settle();
		await input("aside form input", "Design two");
		await js("document.querySelector('aside form').requestSubmit();null;");
		await wait("!document.querySelector('aside form')");
		assert.equal(await js("window.laneTest.libraries()[0].name"), "Design two");
		await screenshot("shortcuts-de");
		await js("window.quakeLocale.set('en')");
		await settle();
		await screenshot("shortcuts-en");
		const before = await js(
			"window.laneTest.integrationRequests.filter(r=>r.type==='shortcuts.generate').length",
		);
		await click("Generate app shortcuts");
		await input("dialog input", "🙂".repeat(25));
		assert.equal(
			await js(
				"Array.from(document.querySelectorAll('dialog button')).find(b=>b.textContent==='Generate').disabled",
			),
			false,
		);
		await input("dialog input", "🙂".repeat(26));
		assert.equal(
			await js(
				"Array.from(document.querySelectorAll('dialog button')).find(b=>b.textContent==='Generate').disabled",
			),
			true,
		);
		await click("Cancel", "document.querySelector('dialog')");
		assert.equal(
			await js(
				"window.laneTest.integrationRequests.filter(r=>r.type==='shortcuts.generate').length",
			),
			before,
		);
		await js("window.laneTest.confirm(false)");
		await click("Delete", "document.querySelector('aside')");
		assert.equal(await js("window.laneTest.libraries().length"), 1);
		await js("window.laneTest.confirm(true)");
		await click("Delete", "document.querySelector('aside')");
		await wait(
			"window.laneTest.libraries().length === 0 && document.querySelectorAll('tbody tr').length === 0",
		);
		await js("window.laneTest.show('tile')");
		await wait(
			"document.querySelector('[data-emoji-asset-state=ready] img')?.naturalWidth > 0",
		);
		assert.equal(
			await js("document.querySelector('[data-type=emoji] img').style.width"),
			"128px",
		);
		assert.equal(
			await js(
				"getComputedStyle(document.querySelector('.strip-tile-title')).color",
			),
			"rgb(255, 0, 0)",
		);
		assert.equal(
			await js(
				"document.querySelector('.strip-tile-title').style.textDecoration",
			),
			"underline",
		);
		await screenshot("emoji-tile");
		await js("window.laneTest.show('tile','inline')");
		await wait(
			"document.querySelector('[data-emoji-asset-state=ready] img')?.naturalWidth > 0",
		);
		await js(
			"window.laneTest.missing(true);window.laneTest.show('tile','d'.repeat(64))",
		);
		await wait(
			"document.querySelector('[data-emoji-asset-state=unavailable]')",
		);
		assert.equal(
			await js("document.querySelector('[data-type=emoji] img')"),
			null,
		);
		await screenshot("emoji-tile-unavailable");
		process.stdout.write(
			"Emoji/shortcuts mounted native PASS: composer, locale, presets, drafts, editor, pack selection, byte bounds, selection/conflicts/reset/delete, save rollback, rename, app icons, pinned tile and fallback.\n",
		);
	} finally {
		win.destroy();
	}
}

// Native confirm is replaced within the isolated fixture so no foreground dialog opens.
// Install the replacement before exercising the mounted delete button.
const run = async () => {
	await smoke();
	const decoded = decodeGif(
		await videoToGif(await readFile(video), AbortSignal.timeout(15000)),
	);
	assert(decoded.frames.length >= 5);
	assert(decoded.frames.every((frame) => frame.delayMs === 100));
	assert(decoded.width <= 256 && decoded.height <= 256);
	assert.notDeepEqual(decoded.frames[0]?.rgba, decoded.frames.at(-1)?.rgba);
	process.stdout.write(
		`Emoji native decoder PASS: ${decoded.frames.length} frames, ${decoded.width}x${decoded.height}.\n`,
	);
};
process.on("uncaughtException", (error) => {
	process.stderr.write(`${error.stack}\n`);
	app.exit(1);
});
process.on("unhandledRejection", (error) => {
	process.stderr.write(`${String(error)}\n`);
	app.exit(1);
});
void run()
	.then(async () => {
		await rm(directory, { recursive: true, force: true });
		app.quit();
	})
	.catch(async (error: unknown) => {
		process.stderr.write(
			`${error instanceof Error ? error.stack : String(error)}\n`,
		);
		await rm(directory, { recursive: true, force: true });
		app.exit(1);
	});
