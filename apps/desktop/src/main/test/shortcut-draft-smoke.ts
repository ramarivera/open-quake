import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { app, BrowserWindow } from "electron";

assert.equal(process.env.OPEN_QUAKE_E2E_RUN, "1");
assert.equal(process.env.OPEN_QUAKE_MOCK_DEVICE, "1");
const scratch = process.env.OPEN_QUAKE_E2E_SCRATCH;
assert(scratch && isAbsolute(scratch));
await mkdir(scratch, { recursive: true });
const directory = await mkdtemp(join(scratch, "shortcut-draft-"));
app.setPath("userData", directory);
app.setPath("sessionData", directory);
if (process.platform === "darwin") app.setActivationPolicy("prohibited");
app.disableHardwareAcceleration();
app.on("browser-window-created", (_event, window) => {
	window.setOpacity(0);
	window.setFocusable(false);
	window.setIgnoreMouseEvents(true);
	window.show = () => {};
	window.showInactive = () => {};
	window.focus = () => {};
});
let step = "startup",
	passed = false,
	blockedClosed = false;
const requests: {
	model: string;
	messages: { role: string; content: string }[];
}[] = [];
const secret = "synthetic-shortcut-secret";
const output = JSON.stringify({
	ConfigTitle: "Editing",
	ConfigData: [
		{
			title: "Copy selection",
			config: {
				functionType: "hotkey",
				actions: [{ type: "key", value: "control+c" }],
			},
		},
		{
			title: "Do not execute",
			config: {
				functionType: "cmd",
				actions: [{ type: "shell", value: "synthetic-forbidden-command" }],
			},
		},
	],
});
const server = createServer(async (request, response) => {
	assert.equal(request.url, "/v1/chat/completions");
	assert.equal(request.headers.authorization, `Bearer ${secret}`);
	let body = "";
	for await (const part of request) body += String(part);
	const input = JSON.parse(body);
	requests.push(input);
	assert.equal(input.tools, undefined);
	response.writeHead(200, { "content-type": "text/event-stream" });
	const packet = (content: string, finish_reason: string | null = null) =>
		`data: ${JSON.stringify({ id: "fixture", model: input.model, object: "chat.completion.chunk", created: 1, choices: [{ index: 0, delta: { content }, finish_reason }] })}\n\n`;
	if (input.messages.at(-1)?.content.endsWith("：block")) {
		response.write(packet(""));
		response.on("close", () => {
			blockedClosed = true;
		});
		return;
	}
	const text = input.messages.at(-1)?.content.endsWith("：invalid")
		? "invalid output"
		: output;
	response.write(packet(text.slice(0, 40)));
	response.write(packet(text.slice(40)));
	response.end(`${packet("", "stop")}data: [DONE]\n\n`);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert(address && typeof address !== "string");
const port = address.port;
const fail = async (cause?: unknown) => {
	process.stderr.write(`SHORTCUT_DRAFT_SMOKE_FAILED ${step}\n`);
	if (cause instanceof Error) process.stderr.write(`${cause.stack}\n`);
	await writeFile(
		join(directory, "result.json"),
		JSON.stringify({ passed: false, step }),
	);
	app.exit(1);
};
const deadline = setTimeout(() => void fail(), 90000);
process.on("uncaughtException", () => void fail());
process.on("unhandledRejection", () => void fail());
const evaluate = (window: BrowserWindow, source: string): Promise<unknown> =>
	window.webContents.executeJavaScript(source);
async function wait(window: BrowserWindow, source: string) {
	const end = Date.now() + 10000;
	while (Date.now() < end) {
		if (await evaluate(window, source)) return;
		await delay(30);
	}
	throw new Error(`Failed at ${step}`);
}
const profiles = () =>
	readFile(join(directory, "profiles-v1.json"), "utf8").catch(() => "absent");
app.once("quit", () => {
	clearTimeout(deadline);
	server.closeAllConnections();
	server.close();
	app.exit(passed ? 0 : 1);
});
step = "import root";
process.stdout.write(`SHORTCUT_DRAFT_STAGE ${step}\n`);
// Electron must be allowed to finish loading the entry module before ready.
// Keep the dynamic production import outside the entry's top-level await chain.
void run();
async function run() {
	try {
		await import("../index");
		step = "app ready";
		await app.whenReady();
		step = "management window";
		let window: BrowserWindow | undefined;
		for (let attempt = 0; attempt < 300 && !window; attempt++) {
			window = BrowserWindow.getAllWindows().find((candidate) =>
				candidate.webContents.getURL().includes("surface=management"),
			);
			if (!window) await delay(30);
		}
		assert(window);
		await wait(
			window,
			"Boolean(window.quakeIntegrations && window.quakeAgents && document.querySelector('.nav'))",
		);
		step = "missing model";
		assert.equal(
			await evaluate(
				window,
				"window.quakeIntegrations.request({type:'shortcuts.generate',app:'Editor',prompt:'copy'}).then(reply=>reply.code)",
			),
			"INTEGRATION.DRAFT.UNAVAILABLE",
		);
		assert.equal(requests.length, 0);
		step = "saved production model and native credential";
		const saved = await evaluate(
			window,
			`(async()=>{const read=await window.quakeAgents.request({type:'read'});if(read._tag!=='success')return read;return window.quakeAgents.request({type:'save-model',scope:'default',revision:read.view.revision,row:{id:'draft',role:'default',provider:'generic',model:'synthetic-shortcut-model',baseUrl:'http://127.0.0.1:${port}/v1',maxTokens:512},secret:${JSON.stringify(secret)}});})()`,
		);
		assert(!JSON.stringify(saved).includes(secret));
		assert(
			saved &&
				typeof saved === "object" &&
				"_tag" in saved &&
				saved._tag === "success",
		);
		step = "shortcuts navigation";
		await evaluate(
			window,
			"document.querySelector('.nav-item[data-nav-page=shortcuts]').click()",
		);
		await wait(
			window,
			"Boolean(document.querySelector('input[maxlength=\"180\"]')) && !document.querySelector('form button[type=submit]')?.disabled",
		);
		await delay(100);
		const originalProfiles = await profiles();
		step = "actual generator control";
		await evaluate(
			window,
			"(()=>{const input=document.querySelector('input[maxlength=\"180\"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'copy text');input.dispatchEvent(new Event('input',{bubbles:true}));})()",
		);
		await evaluate(window, "document.querySelector('form').requestSubmit()");
		await wait(
			window,
			"Array.from(document.querySelectorAll('tbody input')).some(input=>input.value==='Copy selection')",
		);
		assert.equal(requests.length, 1);
		assert.equal(requests[0]?.model, "synthetic-shortcut-model");
		assert.equal(
			await evaluate(
				window,
				"document.querySelector('tbody').textContent.includes('Do not execute')",
			),
			false,
		);
		assert.equal(
			await evaluate(
				window,
				"window.quakeIntegrations.request({type:'shortcuts.list'}).then(reply=>reply.libraries.length)",
			),
			0,
		);
		assert.equal(
			await evaluate(
				window,
				"window.quakeChat.list().then(items=>items.length)",
			),
			0,
		);
		assert.equal(await profiles(), originalProfiles);
		step = "diagnostics";
		await delay(400);
		const logs = (
			await Promise.all(
				(
					await readdir(join(directory, "diagnostics"))
				)
					.filter((name) => name.endsWith(".ndjson"))
					.map((name) =>
						readFile(join(directory, "diagnostics", name), "utf8"),
					),
			)
		).join("\n");
		assert(logs.includes("DesktopChat.draftShortcuts"));
		for (const privateText of [
			secret,
			"synthetic-forbidden-command",
			"copy text",
			"Copy selection",
		])
			assert(!logs.includes(privateText));
		step = "invalid draft preserves table";
		assert.equal(
			await evaluate(
				window,
				"window.quakeIntegrations.request({type:'shortcuts.generate',app:'Editor',prompt:'invalid'}).then(reply=>reply.code)",
			),
			"INTEGRATION.INPUT.REJECTED",
		);
		assert.equal(
			await evaluate(
				window,
				"Array.from(document.querySelectorAll('tbody input')).some(input=>input.value==='Copy selection')",
			),
			true,
		);
		for (const width of [1180, 390]) {
			window.setMinimumSize(390, 560);
			window.setContentSize(width, 625);
			await delay(100);
			await writeFile(
				join(directory, `shortcuts-${width}.png`),
				(await window.webContents.capturePage()).toPNG(),
			);
			await evaluate(
				window,
				"document.querySelector('tbody').scrollIntoView({block:'center'})",
			);
			await delay(100);
			await writeFile(
				join(directory, `shortcuts-results-${width}.png`),
				(await window.webContents.capturePage()).toPNG(),
			);
		}
		assert(
			BrowserWindow.getAllWindows().every(
				(candidate) => !candidate.isVisible(),
			),
		);
		step = "shutdown cancels active draft";
		await evaluate(
			window,
			"globalThis.__pendingShortcut=window.quakeIntegrations.request({type:'shortcuts.generate',app:'Editor',prompt:'block'}).catch(()=>null); true",
		);
		for (let attempt = 0; attempt < 300 && requests.length < 3; attempt++)
			await delay(10);
		assert.equal(requests.length, 3);
		app.once("will-quit", (event) => {
			event.preventDefault();
			void (async () => {
				for (let attempt = 0; attempt < 100 && !blockedClosed; attempt++)
					await delay(10);
				assert(blockedClosed);
				await writeFile(
					join(directory, "result.json"),
					JSON.stringify({
						passed: true,
						requests: requests.length,
						blockedClosed,
						profilesUnchanged: true,
					}),
				);
				passed = true;
				server.closeAllConnections();
				server.close();
				process.stdout.write(`SHORTCUT_DRAFT_SMOKE_OK ${directory}\n`);
				app.exit(0);
			})();
		});
		app.quit();
	} catch (cause) {
		await fail(cause);
	}
}
