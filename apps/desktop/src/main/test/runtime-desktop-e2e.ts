import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { app, BrowserWindow } from "electron";

// Explicit opt-in only. Import the actual composition root, not a parallel
// registration graph. The runner supplies fresh disposable runtime credentials.
assert.equal(process.env.OPEN_QUAKE_E2E_RUN, "1");
assert.equal(process.env.OPEN_QUAKE_MOCK_DEVICE, "1");
const scratch = process.env.OPEN_QUAKE_E2E_SCRATCH;
assert(scratch && isAbsolute(scratch), "Absolute external scratch required");
await mkdir(scratch, { recursive: true });
const directory = await realpath(await mkdtemp(join(scratch, "desktop-e2e-")));
const repository = resolve(import.meta.dirname, "../../../..");
assert(
	relative(repository, directory).startsWith(".."),
	"External scratch required",
);
app.setPath("userData", directory);
app.setPath("sessionData", directory);
// This background acceptance doesn't need to activate a foreground window.
if (process.platform === "darwin") app.setActivationPolicy("prohibited");
app.disableHardwareAcceleration();

let step = "production startup";
let successful = false;
const deadline = setTimeout(() => {
	process.stderr.write(`DESKTOP_E2E_TIMEOUT ${step}\n`);
	app.exit(1);
}, 240_000);
await import("../index");

const evaluate = (win: BrowserWindow, source: string): Promise<unknown> =>
	win.webContents.executeJavaScript(source);
async function wait(win: BrowserWindow, expression: string, timeout = 15_000) {
	const end = Date.now() + timeout;
	while (Date.now() < end) {
		if (await evaluate(win, expression)) return;
		await delay(50);
	}
	throw new Error(`Desktop acceptance failed at ${step}`);
}
async function button(win: BrowserWindow, label: string) {
	const expression = `Array.from((document.querySelector('dialog[open]') ?? document).querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)} && !b.disabled && b.getClientRects().length)`;
	await wait(win, `Boolean(${expression})`);
	await evaluate(win, `${expression}.click()`);
	await delay(100);
}
async function input(win: BrowserWindow, selector: string, value: string) {
	await wait(
		win,
		`Boolean(document.querySelector(${JSON.stringify(selector)}))`,
	);
	await evaluate(
		win,
		`(()=>{const el=document.querySelector(${JSON.stringify(selector)}); const prototype=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype,'value').set.call(el,${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
	);
	await delay(75);
}
async function select(win: BrowserWindow, selector: string, value: string) {
	await evaluate(
		win,
		`(()=>{const el=document.querySelector(${JSON.stringify(selector)}); el.value=${JSON.stringify(value)}; el.dispatchEvent(new Event('change',{bubbles:true}));})()`,
	);
	await delay(100);
}

app.once("quit", () => {
	clearTimeout(deadline);
	app.exit(successful ? 0 : 1);
});

async function run() {
	await app.whenReady();
	let win: BrowserWindow | undefined;
	const startupDeadline = Date.now() + 20_000;
	while (!win && Date.now() < startupDeadline) {
		win = BrowserWindow.getAllWindows().find((candidate) =>
			candidate.webContents.getURL().includes("surface=management"),
		);
		if (!win) await delay(50);
	}
	assert(win, "Production management window required");
	await wait(
		win,
		"typeof window.quakeAgentConnections?.request==='function' && document.querySelector('.nav')",
	);
	// Navigate with the real sidebar and session tab, rather than mounting a
	// test component or invoking a fake service.
	await button(win, "OpenClaw");
	await button(win, "Agent sessions");
	await wait(win, "Boolean(document.querySelector('.agent-http'))");
	const token = process.env.OPEN_QUAKE_E2E_RUNTIME_TOKEN;
	assert(token, "Disposable API bearer required");
	for (const kind of ["hermes", "openclaw"] as const) {
		step = `${kind} connection save and selection`;
		const baseURL =
			process.env[
				kind === "hermes"
					? "OPEN_QUAKE_E2E_HERMES_URL"
					: "OPEN_QUAKE_E2E_OPENCLAW_URL"
			];
		assert(
			baseURL && /^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL),
			"Disposable loopback runtime required",
		);
		await button(win, "Add connection");
		await input(win, ".agent-http-form input:not([type])", `E2E ${kind}`);
		await select(win, ".agent-http-form select", kind);
		await input(win, ".agent-http-form input[type=url]", baseURL);
		await input(win, ".agent-http-form input[type=password]", token);
		await button(win, "Save connection");
		await wait(
			win,
			`!document.querySelector('.agent-http-form') && Boolean(document.querySelector('.agent-http textarea:not(:disabled)')) && document.querySelector('section[aria-label=Conversation] .mc-badge')?.textContent === ${JSON.stringify(`E2E ${kind}`)} && document.querySelector('.agent-http-address')?.textContent === ${JSON.stringify(`${baseURL}/`)}`,
			30_000,
		);
		const selected = await evaluate(
			win,
			`(async()=>{const reply=await window.quakeAgentConnections.request({type:'list'}); if(reply._tag!=='success')return false; const connection=reply.view.connections.find(c=>c.id===reply.view.selected?.connectionId); return connection?.kind===${JSON.stringify(kind)} && connection?.baseURL===${JSON.stringify(`${baseURL}/`)} && connection?.name===${JSON.stringify(`E2E ${kind}`)} ? connection.id : false;})()`,
		);
		assert.equal(
			typeof selected,
			"string",
			"Actual persisted selected runtime must match the intended provider and endpoint",
		);
		await button(win, "Test connection");
		await wait(
			win,
			"Array.from(document.querySelectorAll('.agent-http [role=status]')).some(e=>e.textContent==='Ready')",
		);
		if (kind === "hermes") {
			await select(
				win,
				"section[aria-label=Conversation] label.mc-field select",
				"e2e-default",
			);
		}
		// Observe the same preload stream that the actual React controller consumes.
		await evaluate(
			win,
			"window.__oqE2e={completed:0,tools:0,sessionIds:[],connectionIds:[]}; window.__oqE2eOff=window.quakeAgentConversations.onEvent(e=>{if(e.event?._tag==='completed'){window.__oqE2e.completed++;window.__oqE2e.connectionIds.push(e.connectionId);window.__oqE2e.sessionIds.push(e.event.sessionId)} if(e.event?._tag==='tool')window.__oqE2e.tools++}); true",
		);
		const marker = `OQ_${randomUUID().replaceAll("-", "")}`;
		step = `${kind} first streamed reply`;
		await input(
			win,
			".agent-http textarea",
			`Remember the exact marker ${marker}. Reply only with that marker. Do not use tools.`,
		);
		await button(win, "Send message");
		await wait(
			win,
			`document.querySelector('.agent-http-transcript')?.textContent.includes(${JSON.stringify(marker)}) && !document.querySelector('.agent-http textarea')?.disabled`,
			90_000,
		);
		step = `${kind} remote session continuation`;
		await input(
			win,
			".agent-http textarea",
			"What exact marker did I give you in my previous message? Reply only with that marker. Do not use tools.",
		);
		await button(win, "Send message");
		await wait(
			win,
			"document.querySelectorAll('.agent-http-message').length===4 && !document.querySelector('.agent-http textarea')?.disabled",
			90_000,
		);
		assert.equal(
			await evaluate(
				win,
				`Array.from(document.querySelectorAll('.agent-http-message')).filter((_,i)=>i%2===1).every(e=>e.textContent.includes(${JSON.stringify(marker)}))`,
			),
			true,
			"Both actual rendered replies must contain the marker",
		);
		await wait(win, "window.__oqE2e.completed===2");
		assert.equal(
			await evaluate(
				win,
				"window.__oqE2e.tools===0 && window.__oqE2e.sessionIds.length===2 && Boolean(window.__oqE2e.sessionIds[0]) && window.__oqE2e.sessionIds[0]===window.__oqE2e.sessionIds[1]",
			),
			true,
			"Exactly one completion per turn and one real remote session required",
		);
		assert.equal(
			await evaluate(
				win,
				`window.__oqE2e.connectionIds.length===2 && window.__oqE2e.connectionIds.every(id=>id===${JSON.stringify(selected)})`,
			),
			true,
			"Both real conversation events must come from the intended selected runtime",
		);
		await evaluate(
			win,
			"document.querySelector('section[aria-label=Conversation]').scrollIntoView({block:'start'}); true",
		);
		await delay(100);
		await writeFile(
			join(directory, `${kind}-conversation.png`),
			(await win.webContents.capturePage()).toPNG(),
		);
		await evaluate(win, "window.__oqE2eOff(); true");
		step = `${kind} clear local history`;
		await button(win, "Clear local history");
		await button(win, "Clear local history");
		await wait(
			win,
			"document.querySelectorAll('.agent-http-message').length===0",
		);
		process.stdout.write(
			`DESKTOP_E2E_PASS ${kind} selection, discovery, UI, IPC, stream and continuation\n`,
		);
	}
	step = "production shutdown";
	await writeFile(
		join(directory, "result.json"),
		JSON.stringify({ passed: true, step }),
		{ mode: 0o600 },
	);
	successful = true;
	process.stdout.write("DESKTOP_E2E_PASS production root and preload\n");
	app.quit();
}
void run().catch(async () => {
	try {
		await writeFile(
			join(directory, "result.json"),
			JSON.stringify({ passed: false, step }),
			{ mode: 0o600 },
		);
	} catch {
		/* The destination may itself be unavailable. */
	} finally {
		// Never print arbitrary renderer/provider errors or token-bearing JS source.
		process.stderr.write(`DESKTOP_E2E_FAILED ${step}\n`);
		app.quit();
	}
});
