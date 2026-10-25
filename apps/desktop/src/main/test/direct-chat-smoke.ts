import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { isAbsolute, join, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { app, BrowserWindow } from "electron";

// Actual app root, settings, preload and React UI. All inference is synthetic loopback.
assert.equal(process.env.OPEN_QUAKE_E2E_RUN, "1");
assert.equal(process.env.OPEN_QUAKE_MOCK_DEVICE, "1");
const scratch = process.env.OPEN_QUAKE_E2E_SCRATCH;
assert(scratch && isAbsolute(scratch));
await mkdir(scratch, { recursive: true });
const directory = await mkdtemp(join(scratch, "direct-chat-"));
assert(
	relative(resolve(import.meta.dirname, "../../../.."), directory).startsWith(
		"..",
	),
);
app.setPath("userData", directory);
app.setPath("sessionData", directory);
if (process.platform === "darwin") app.setActivationPolicy("prohibited");
app.disableHardwareAcceleration();

const requests: {
	model: string;
	messages: { role: string; content: string }[];
}[] = [];
let blockedClosed = false;
const secret = "synthetic-direct-chat-secret";
const answer =
	'## Synthetic answer\n\n<img src="https://invalid.example/image">\n<script>globalThis.__unsafe=true</script>\n\n```sh\necho inert\n```';
const server = createServer(async (req, res) => {
	assert.equal(req.url, "/v1/chat/completions");
	assert.equal(req.headers.authorization, `Bearer ${secret}`);
	let body = "";
	for await (const part of req) body += String(part);
	const input = JSON.parse(body);
	requests.push(input);
	if (input.messages.at(-1)?.content === "fail") {
		res.writeHead(401);
		res.end("synthetic failure");
		return;
	}
	res.writeHead(200, { "content-type": "text/event-stream" });
	const packet = (text: string, finish: string | null) =>
		`data: ${JSON.stringify({ id: "fixture", model: input.model, object: "chat.completion.chunk", created: 1, choices: [{ index: 0, delta: { content: text }, finish_reason: finish }] })}\n\n`;
	res.write(packet(answer, null));
	if (input.messages.at(-1)?.content === "block") {
		res.on("close", () => {
			blockedClosed = true;
		});
		return;
	}
	res.write(packet("", "stop"));
	res.end("data: [DONE]\n\n");
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
assert(address && typeof address !== "string");
const port = address.port;
let step = "startup",
	passed = false;
const deadline = setTimeout(() => {
	process.stderr.write(`DIRECT_CHAT_SMOKE_TIMEOUT ${step}\n`);
	app.exit(1);
}, 90_000);
await import("../index");
const evaluate = (win: BrowserWindow, code: string): Promise<unknown> =>
	win.webContents.executeJavaScript(code);
async function wait(win: BrowserWindow, code: string) {
	const end = Date.now() + 10_000;
	while (Date.now() < end) {
		if (await evaluate(win, code)) return;
		await delay(40);
	}
	throw new Error(`Failed at ${step}`);
}
async function click(win: BrowserWindow, text: string) {
	const code = `Array.from((document.querySelector('dialog[open]')??document).querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled&&b.getClientRects().length)`;
	await wait(win, `Boolean(${code})`);
	await evaluate(win, `${code}.click()`);
}
async function send(win: BrowserWindow, text: string) {
	await evaluate(
		win,
		`(()=>{const el=document.querySelector('.direct-chat textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
	);
	await click(win, "Send");
}
app.once("quit", () => {
	clearTimeout(deadline);
	server.closeAllConnections();
	server.close();
	app.exit(passed ? 0 : 1);
});
async function run() {
	await app.whenReady();
	let win: BrowserWindow | undefined;
	const end = Date.now() + 15_000;
	while (!win && Date.now() < end) {
		win = BrowserWindow.getAllWindows().find((w) =>
			w.webContents.getURL().includes("surface=management"),
		);
		if (!win) await delay(50);
	}
	assert(win);
	await wait(
		win,
		"typeof window.quakeChat?.submit==='function' && Boolean(document.querySelector('.nav'))",
	);

	step = "saved locale broadcasts without renderer reload";
	await wait(win, "typeof window.quakeLocale?.set==='function'");
	const originalLocale = await evaluate(
		win,
		"window.quakeLocale.read().then(s=>s.locale)",
	);
	await evaluate(win, "globalThis.__localeMount = 'same-document'");
	await evaluate(win, "window.quakeLocale.set('de')");
	await wait(win, "document.documentElement.lang==='de'");
	const panel = BrowserWindow.getAllWindows().find((w) =>
		w.webContents.getURL().includes("surface=panel"),
	);
	assert(panel);
	await wait(panel, "document.documentElement.lang==='de'");
	assert.equal(
		await evaluate(win, "globalThis.__localeMount"),
		"same-document",
	);
	await evaluate(win, "window.quakeLocale.set('en')");
	await wait(win, "document.documentElement.lang==='en'");
	await wait(panel, "document.documentElement.lang==='en'");
	assert.equal(
		await evaluate(win, "globalThis.__localeMount"),
		"same-document",
	);
	assert.equal(typeof originalLocale, "string");
	step = "persisted model and protected credential settings";
	assert.equal(
		await evaluate(
			win,
			`(async()=>{const previous=await window.quakeAgents.request({type:'read'});if(previous._tag!=='success')return false;const saved=await window.quakeAgents.request({type:'save-model',scope:'default',row:{id:'smoke',role:'default',provider:'generic',model:'synthetic-model',baseUrl:'http://127.0.0.1:${port}/v1',maxTokens:512},secret:${JSON.stringify(secret)},revision:previous.view.revision});return saved._tag==='success' && saved.view.models.default.some(row=>row.model==='synthetic-model'&&row.credentialAvailable) && !JSON.stringify(saved).includes(${JSON.stringify(secret)});})()`,
		),
		true,
	);
	await click(win, "OpenClaw");
	await click(win, "Agent sessions");
	await wait(
		win,
		"Boolean(document.querySelector('.direct-chat textarea:not(:disabled)'))",
	);
	step = "real React stream and inert generated markup";
	await send(win, "first message");
	await wait(
		win,
		"document.querySelector('.direct-chat-transcript')?.textContent.includes('Synthetic answer')&&!document.querySelector('.direct-chat textarea').disabled",
	);
	assert.equal(
		await evaluate(
			win,
			"document.querySelectorAll('.direct-chat-transcript script,.direct-chat-transcript img').length===0 && globalThis.__unsafe!==true",
		),
		true,
	);
	assert.equal(requests.length, 1);
	assert.equal(requests[0]?.model, "synthetic-model");
	step = "history continuation";
	await send(win, "second message");
	await wait(
		win,
		"document.querySelectorAll('.direct-chat-exchange').length===2&&!document.querySelector('.direct-chat textarea').disabled",
	);
	assert(
		requests[1]?.messages.some(
			(message) => message.role === "assistant" && message.content === answer,
		),
	);

	for (const width of [1180, 390]) {
		win.webContents.enableDeviceEmulation({
			screenPosition: "desktop",
			screenSize: { width, height: 900 },
			viewPosition: { x: 0, y: 0 },
			deviceScaleFactor: 1,
			viewSize: { width, height: 900 },
			scale: 1,
		});
		await delay(100);
		assert.equal(await evaluate(win, "window.innerWidth"), width);
		assert.equal(
			await evaluate(
				win,
				"(()=>{const panel=document.querySelector('.direct-chat');return panel.scrollWidth<=panel.clientWidth+1;})()",
			),
			true,
		);
		await writeFile(
			join(directory, `chat-${width}.png`),
			(
				await win.webContents.capturePage({ x: 0, y: 0, width, height: 900 })
			).toPNG(),
		);
	}
	win.webContents.disableDeviceEmulation();
	step = "physical provider cancellation through UI";
	await send(win, "block");
	await wait(
		win,
		"Boolean(Array.from(document.querySelectorAll('.direct-chat button')).find(b=>b.textContent==='Stop response'))",
	);
	while (requests.length < 3) await delay(20);
	await delay(75);

	const beforeLocale = await evaluate(
		win,
		"document.querySelector('.direct-chat-transcript').textContent",
	);
	await evaluate(win, "window.quakeLocale.set('de')");
	await wait(win, "document.documentElement.lang==='de'");
	assert.equal(
		await evaluate(
			win,
			"document.querySelector('.direct-chat-transcript').textContent",
		),
		beforeLocale,
	);
	assert.equal(
		await evaluate(
			win,
			"document.querySelector('.direct-chat textarea').disabled",
		),
		true,
	);
	assert.equal(requests.length, 3);
	assert.equal(blockedClosed, false);
	await evaluate(win, "window.quakeLocale.set('en')");
	await wait(win, "document.documentElement.lang==='en'");
	await click(win, "Stop response");
	await wait(
		win,
		"!document.querySelector('.direct-chat textarea').disabled && document.querySelector('.direct-chat-transcript').textContent.includes('cancelled')",
	);
	for (let attempt = 0; !blockedClosed && attempt < 50; attempt++)
		await delay(20);
	assert(blockedClosed, "Blocked provider socket must close");
	step = "provider failure and scrubbed diagnostics";
	await send(win, "fail");
	await wait(
		win,
		"!document.querySelector('.direct-chat textarea').disabled && document.querySelector('.direct-chat-transcript').textContent.includes('AI.PROVIDER.AUTH_REQUIRED')",
	);
	assert.equal(requests.length, 4);
	step = "rename and deletion";
	await evaluate(
		win,
		"(()=>{const el=document.querySelector('.direct-chat input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'My saved chat');el.dispatchEvent(new Event('input',{bubbles:true}));})()",
	);
	await click(win, "Rename");
	await wait(
		win,
		"document.querySelector('.direct-chat-history').textContent.includes('My saved chat')",
	);
	await click(win, "Delete conversation");
	await delay(50);
	await click(win, "Delete conversation");
	await wait(
		win,
		"document.querySelectorAll('.direct-chat-history button').length===0",
	);
	assert.deepEqual(await evaluate(win, "window.quakeChat.list()"), []);
	step = "diagnostics";
	// Completed spans are flushed on a bounded timer, without logging prompt/key content.
	await delay(400);
	const logs = (
		await Promise.all(
			(
				await readdir(join(directory, "diagnostics"))
			)
				.filter((name) => name.endsWith(".ndjson"))
				.map((name) => readFile(join(directory, "diagnostics", name), "utf8")),
		)
	).join("\n");
	assert(logs.includes("ChatService.submit"));
	assert(logs.includes("AI.PROVIDER.AUTH_REQUIRED"));
	assert(!logs.includes(secret));
	assert(!logs.includes(answer));
	assert(!logs.includes("first message"));
	await writeFile(
		join(directory, "result.json"),
		JSON.stringify({
			passed: true,
			syntheticProvider: true,
			actualRoot: true,
			actualPreload: true,
			actualReact: true,
			physicalAbort: true,
			safeMarkup: true,
			history: true,
			diagnostics: true,
			screenshots: [1180, 390],
			viewportEmulation: true,
			hardwareVerified: false,
		}),
		{ mode: 0o600 },
	);
	passed = true;
	process.stdout.write(`DIRECT_CHAT_SMOKE_OK ${directory}\n`);
	app.quit();
}
void run().catch(async (cause) => {
	await writeFile(
		join(directory, "failure.json"),
		JSON.stringify({
			step,
			requests: requests.length,
			blockedClosed,
			error: cause instanceof Error ? cause.message : "unknown",
		}),
		{ mode: 0o600 },
	).catch(() => undefined);
	await writeFile(
		join(directory, "result.json"),
		JSON.stringify({ passed: false, step }),
		{ mode: 0o600 },
	).catch(() => undefined);
	process.stderr.write(`DIRECT_CHAT_SMOKE_FAILED ${step}\n`);
	app.quit();
});
