/** Explicit fixture entry. Not reachable from entry.ts or a packaged application. */
import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Option, Schema } from "effect";
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { builtinProfiles } from "../../../../../packages/device/src/profiles/profile-catalog";
import {
	encodeProfileEnvelope,
	ProfileEnvelope,
} from "../../../../../packages/device/src/profiles/profile-contracts";
import { KeyReply } from "../../shared/key-library";
import { managementExerciserBus } from "../mockDeviceBus";
import {
	type Control,
	enumerateControls,
	installObserver,
	observation,
} from "./exerciser-dom";
import { expectedInert, skipReason, skipRules } from "./exerciser-policy";

assert(!app.isPackaged, "Management exerciser is forbidden in packaged apps");
assert.equal(
	process.env.OPEN_QUAKE_MOCK_DEVICE,
	"1",
	"Use only exerciser.config.ts",
);
assert(
	!process.env.ELECTRON_RENDERER_URL,
	"Exercise production files, never a dev server",
);
const directory = resolve(process.argv[2] ?? "");
assert(
	directory.startsWith(
		"/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-ui-exerciser/run-",
	),
);
const userData = join(directory, "userData");

interface Result {
	page: string;
	control: string;
	identity?: string;
	status: "passed" | "failed" | "skipped" | "expected-inert";
	reason?: string | undefined;
	effects?: string[];
	ipc?: Record<string, number>;
}
const results: Result[] = [];
const visited: string[] = [];
const errors: { source: string; message: string }[] = [];
const invocations = new Map<string, number>();
const controlInvocations = new Map<string, number>();
function recordInvocation(
	channel: string,
	event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
	args: readonly unknown[],
) {
	invocations.set(channel, (invocations.get(channel) ?? 0) + 1);
	if (!event.sender.getURL().includes("surface=management")) return;
	const input = args[0];
	const operation =
		typeof input === "object" && input !== null
			? "type" in input
				? input.type
				: "_tag" in input
					? input._tag
					: ""
			: "";
	if (
		["read", "query", "snapshot", "status"].includes(String(operation)) ||
		/status|device-ready|strip-message|ready$/.test(channel)
	)
		return;
	controlInvocations.set(channel, (controlInvocations.get(channel) ?? 0) + 1);
}
const mainReplies: {
	channel: string;
	type: string;
	reason: string;
	sender: number;
}[] = [];
let dialogs = 0;
let windowsCreated = 0;
let navigations = 0;
let finished = false;
let pages: readonly string[] = [];
const registered = { handle: [] as string[], on: [] as string[] };
const message = (cause: unknown): string =>
	cause instanceof Error ? cause.message : String(cause);

// Install before importing index.ts. Never record request payloads or serials.
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => {
	registered.handle.push(channel);
	handle(channel, async (event, ...args: unknown[]) => {
		recordInvocation(channel, event, args);
		try {
			const reply: unknown = await listener(event, ...args);
			if (
				typeof reply === "object" &&
				reply !== null &&
				"_tag" in reply &&
				reply._tag === "rejected"
			) {
				const input = args[0];
				mainReplies.push({
					channel,
					sender: event.sender.id,
					type:
						typeof input === "object" && input !== null && "type" in input
							? String(input.type)
							: "",
					reason: "reason" in reply ? String(reply.reason) : "rejected",
				});
			}
			return reply;
		} catch (cause) {
			errors.push({ source: `ipc:${channel}`, message: message(cause) });
			throw cause;
		}
	});
};
const on = ipcMain.on.bind(ipcMain);
const removeListener = ipcMain.removeListener.bind(ipcMain);
const registeredListeners: {
	channel: string;
	listener: Parameters<typeof ipcMain.on>[1];
	wrapped: Parameters<typeof ipcMain.on>[1];
}[] = [];
ipcMain.on = (channel, listener) => {
	registered.on.push(channel);
	const wrapped: Parameters<typeof ipcMain.on>[1] = (
		event,
		...args: unknown[]
	) => {
		recordInvocation(channel, event, args);
		try {
			listener(event, ...args);
		} catch (cause) {
			errors.push({ source: `ipc:${channel}`, message: message(cause) });
		}
	};
	registeredListeners.push({ channel, listener, wrapped });
	return on(channel, wrapped);
};
ipcMain.removeListener = (channel, listener) => {
	let index = registeredListeners.length - 1;
	while (
		index >= 0 &&
		!(
			registeredListeners[index]?.channel === channel &&
			registeredListeners[index]?.listener === listener
		)
	)
		index--;
	const entry = registeredListeners[index];
	if (entry) registeredListeners.splice(index, 1);
	return removeListener(channel, entry?.wrapped ?? listener);
};
ipcMain.off = ipcMain.removeListener;
// Native sheets would take focus. Record their opening and cancel them at the OS edge.
dialog.showOpenDialog = async () => {
	dialogs++;
	return { canceled: true, filePaths: [] };
};
dialog.showSaveDialog = async () => {
	dialogs++;
	return { canceled: true, filePath: "" };
};
dialog.showMessageBox = async () => {
	dialogs++;
	return { response: 0, checkboxChecked: false };
};
dialog.showErrorBox = () => {
	dialogs++;
	errors.push({ source: "dialog", message: "Native error dialog requested" });
};
Menu.prototype.popup = () => {
	dialogs++;
};
shell.openExternal = async () => {
	dialogs++;
};
shell.openPath = async () => {
	dialogs++;
	return "Blocked by management exerciser";
};
shell.showItemInFolder = () => {
	dialogs++;
};
app.setLoginItemSettings = () => {
	throw new Error("Management exerciser forbids changing login items");
};
app.on("browser-window-created", (_event, win) => {
	windowsCreated++;
	win.show = () => {};
	win.showInactive = () => {};
	win.focus = () => {};
	win.moveTop = () => {};
	win.setFocusable(false);
	win.webContents.setBackgroundThrottling(false);
	win.webContents.setAudioMuted(true);
	// Chromium focus only. The native window remains hidden and non-focusable.
	win.webContents.debugger.attach("1.3");
	void win.webContents.debugger
		.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true })
		.catch((cause: unknown) => {
			if (!win.isDestroyed())
				errors.push({
					source: "renderer-focus-emulation",
					message: message(cause),
				});
		});
	win.webContents.on("console-message", (details) => {
		if (details.level === "error")
			errors.push({ source: "renderer-console", message: details.message });
	});
	win.webContents.on("render-process-gone", (_event, details) =>
		errors.push({ source: "renderer", message: details.reason }),
	);
	win.webContents.on("did-navigate", () => navigations++);
	win.webContents.on("did-navigate-in-page", () => navigations++);
	win.webContents.on("dom-ready", () => {
		void win.webContents
			.executeJavaScript(`(${installObserver.toString()})()`)
			.catch((cause: unknown) =>
				errors.push({ source: "observer", message: message(cause) }),
			);
	});
});
process.on("uncaughtException", (cause) => {
	errors.push({ source: "main", message: message(cause) });
});
process.on("unhandledRejection", (cause: unknown) => {
	errors.push({ source: "main", message: message(cause) });
});

const evaluate = (win: BrowserWindow, script: string): Promise<unknown> =>
	win.webContents.executeJavaScript(script);
async function waitFor(
	win: BrowserWindow,
	script: string,
	description: string,
	ms = 7000,
): Promise<void> {
	const deadline = Date.now() + ms;
	do {
		if (await evaluate(win, script)) return;
		await delay(50);
	} while (Date.now() < deadline);
	throw new Error(`Timed out: ${description}`);
}
function key(
	win: BrowserWindow,
	keyCode: string,
	modifiers: Electron.KeyboardInputEvent["modifiers"] = [],
) {
	win.webContents.focus();
	win.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
	win.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
}
async function click(win: BrowserWindow, selector: string): Promise<void> {
	await evaluate(
		win,
		`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center',inline:'center'})`,
	);
	await delay(120);
	const point = Schema.decodeUnknownSync(
		Schema.Struct({ x: Schema.Number, y: Schema.Number, hit: Schema.Boolean }),
	)(
		await evaluate(
			win,
			`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return undefined;const r=el.getBoundingClientRect();if(!r.width||!r.height)return undefined;const x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);const hit=document.elementFromPoint(x,y);return {x,y,hit:hit===el||el.contains(hit)}})()`,
		),
	);
	assert(point.hit, `Control centre is obstructed: ${selector}`);
	win.webContents.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y });
	win.webContents.sendInputEvent({
		type: "mouseDown",
		button: "left",
		clickCount: 1,
		x: point.x,
		y: point.y,
	});
	win.webContents.sendInputEvent({
		type: "mouseUp",
		button: "left",
		clickCount: 1,
		x: point.x,
		y: point.y,
	});
	await delay(180);
}
async function select(
	win: BrowserWindow,
	selector: string,
	value: string,
	verify = true,
): Promise<void> {
	const options = Schema.decodeUnknownSync(Schema.Array(Schema.String))(
		await evaluate(
			win,
			`Array.from((document.querySelector(${JSON.stringify(selector)})?.options ?? [])).map(o=>o.value)`,
		),
	);
	const index = options.indexOf(value);
	assert(index >= 0, `Missing selector option ${value}`);
	if (
		await evaluate(
			win,
			`document.querySelector(${JSON.stringify(selector)})?.matches(':disabled')`,
		)
	)
		return;
	// DOM focus stays inside the hidden renderer. Native keyboard input changes the select.
	await evaluate(
		win,
		`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'});document.querySelector(${JSON.stringify(selector)}).focus()`,
	);
	if (
		(await evaluate(
			win,
			`document.querySelector(${JSON.stringify(selector)}).value`,
		)) !== value
	) {
		const labels = Schema.decodeUnknownSync(Schema.Array(Schema.String))(
			await evaluate(
				win,
				`Array.from((document.querySelector(${JSON.stringify(selector)})?.options ?? [])).map(o=>o.textContent.trim())`,
			),
		);
		const label = labels[index];
		assert(label);
		// Clear Chromium's type-ahead buffer before entering the option label.
		await delay(1100);
		for (const character of label) {
			await evaluate(
				win,
				`document.querySelector(${JSON.stringify(selector)})?.focus()`,
			);
			if (character !== " ")
				win.webContents.sendInputEvent({ type: "keyDown", keyCode: character });
			win.webContents.sendInputEvent({ type: "char", keyCode: character });
			if (character !== " ")
				win.webContents.sendInputEvent({ type: "keyUp", keyCode: character });
			await delay(30);
		}
		await delay(350);
	}
	key(win, "Tab");
	await delay(180);
	if (verify)
		assert.equal(
			await evaluate(
				win,
				`document.querySelector(${JSON.stringify(selector)})?.value`,
			),
			value,
			`Native selector didn't reach requested option: ${JSON.stringify(await evaluate(win, "({focused:document.activeElement?.id,visible:document.visibilityState,hasFocus:document.hasFocus(),inputs:window.managementExercise?.inputs,keys:window.managementExercise?.keys})"))}`,
		);
}
async function textInput(
	win: BrowserWindow,
	selector: string,
	value: string,
): Promise<void> {
	await click(win, selector);
	// Replace the existing text; the menu-less window ignores the select-all chord.
	await evaluate(
		win,
		`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el?.focus(); el?.select?.(); })()`,
	);
	await win.webContents.insertText(value);
	key(win, "Tab");
	await delay(180);
}
const selectorFor = (control: Control) => control.selector;
async function snapshot(win: BrowserWindow) {
	return {
		dom: await evaluate(win, `(${observation.toString()})()`),
		ipc: Object.fromEntries(controlInvocations),
		dialogs,
		windowsCreated,
		navigations,
		errors: errors.length,
	};
}
async function exercise(
	win: BrowserWindow,
	page: string,
	control: Control,
): Promise<void> {
	const skip = skipReason(control);
	if (skip) {
		results.push({
			page,
			control: control.label,
			identity: control.identity,
			status: "skipped",
			reason: skip,
		});
		return;
	}
	if (
		control.selected ||
		(control.tag === "select" && control.options.length < 2)
	) {
		results.push({
			page,
			control: control.label,
			identity: control.identity,
			status: "expected-inert",
			reason:
				(control.selected ? expectedInert[0] : expectedInert[1])?.reason ??
				"Reviewed inert control",
		});
		return;
	}
	const selector = selectorFor(control);
	// Settle scrolling/hover before observing effects, so our own positioning can't pass a dead button.
	await evaluate(
		win,
		`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center'})`,
	);
	await delay(120);
	const before = await snapshot(win);
	const replyStart = mainReplies.length;
	try {
		if (control.tag === "select") {
			const currentIndex = control.options.indexOf(control.value);
			const next =
				control.options[
					currentIndex < control.options.length - 1
						? currentIndex + 1
						: currentIndex - 1
				];
			assert(next !== undefined);
			await select(win, selector, next, false);
		} else if (
			["input", "textarea"].includes(control.tag) &&
			!["checkbox", "radio", "range", "button", "submit"].includes(control.type)
		) {
			await textInput(
				win,
				selector,
				control.type === "number" ||
					/^(?:force|level|gap|duration|delay)$/i.test(control.label) ||
					/^-?\d+(?:\.\d+)?$/.test(control.value)
					? "1"
					: "exercise",
			);
		} else if (control.type === "range") {
			await evaluate(
				win,
				`document.querySelector(${JSON.stringify(selector)}).focus()`,
			);
			key(win, "Right");
		} else await click(win, selector);
		await delay(350);
		const after = await snapshot(win);
		const effects: string[] = [];
		const beforeDom = Schema.decodeUnknownSync(
			Schema.Struct({
				mutations: Schema.Number,
				navigation: Schema.Number,
				dialogs: Schema.Number,
				inputs: Schema.Number,
				editable: Schema.String,
				values: Schema.Unknown,
				errors: Schema.Array(Schema.String),
			}),
		)(before.dom);
		const afterDom = Schema.decodeUnknownSync(
			Schema.Struct({
				mutations: Schema.Number,
				navigation: Schema.Number,
				dialogs: Schema.Number,
				inputs: Schema.Number,
				editable: Schema.String,
				values: Schema.Unknown,
				errors: Schema.Array(Schema.String),
			}),
		)(after.dom);
		if (
			afterDom.mutations > beforeDom.mutations ||
			JSON.stringify(afterDom.values) !== JSON.stringify(beforeDom.values)
		)
			effects.push("DOM change");
		if (afterDom.editable && afterDom.editable !== beforeDom.editable)
			effects.push("editable focus");
		if (after.dialogs > before.dialogs || afterDom.dialogs > beforeDom.dialogs)
			effects.push("dialog opening intercepted");
		if (after.windowsCreated > before.windowsCreated)
			effects.push("window/sheet opened");
		if (
			after.navigations > before.navigations ||
			afterDom.navigation > beforeDom.navigation
		)
			effects.push("navigation");
		const ipc = Object.fromEntries(
			Object.entries(after.ipc).flatMap(([channel, count]) => {
				const delta = count - (before.ipc[channel] ?? 0);
				// Periodic status notifications aren't caused by the control.
				return delta > 0 &&
					!/status|telemetry|metrics|poll|progress/.test(channel)
					? [[channel, delta]]
					: [];
			}),
		);
		if (Object.keys(ipc).length) effects.push("IPC invocation");
		const rejected = mainReplies
			.slice(replyStart)
			.filter((reply) => reply.sender === win.webContents.id);
		const failed =
			!effects.length ||
			afterDom.inputs <= beforeDom.inputs ||
			after.errors > before.errors ||
			afterDom.errors.length > beforeDom.errors.length ||
			rejected.length > 0;
		results.push({
			page,
			control: control.label,
			identity: control.identity,
			status: failed ? "failed" : "passed",
			effects,
			ipc,
			reason: rejected.length
				? JSON.stringify(rejected)
				: failed
					? effects.length
						? afterDom.inputs <= beforeDom.inputs
							? "No trusted renderer input received"
							: "Renderer/main error during activation"
						: "No DOM, IPC, dialog, navigation or editable-focus effect"
					: undefined,
		});
	} catch (cause) {
		results.push({
			page,
			control: control.label,
			identity: control.identity,
			status: "failed",
			reason: message(cause),
		});
	}
}
async function capture(win: BrowserWindow, name: string) {
	await writeFile(
		join(directory, `${name}.png`),
		(await win.webContents.capturePage()).toPNG(),
		{ mode: 0o600 },
	);
}
/** Dismiss modals left open by exploration so the sidebar stays reachable. */
async function closeDialogs(win: BrowserWindow): Promise<void> {
	const open = `document.querySelectorAll('dialog[open], [role=dialog][aria-modal=true]').length`;
	for (let attempt = 0; attempt < 3 && (await evaluate(win, open)); attempt++) {
		key(win, "Escape");
		await delay(200);
	}
	await evaluate(
		win,
		`document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close())`,
	);
}
async function navigate(win: BrowserWindow, page: string) {
	await closeDialogs(win);
	await click(win, `.nav-item[data-nav-page="${page}"]`);
	await waitFor(
		win,
		`document.querySelector('.nav-item[data-nav-page="${page}"]')?.getAttribute('aria-current')==='page'`,
		`navigation ${page}`,
	);
	await delay(500);
	await waitFor(
		win,
		"!Array.from(document.querySelectorAll('main')).some(el=>/^Loading profiles...$/.test(el.innerText.trim()))",
		"page data",
	);
}
async function readKeys(win: BrowserWindow) {
	const reply = Schema.decodeUnknownSync(KeyReply)(
		await evaluate(
			win,
			'window.quakeKeyLibrary.request({type:"read",locale:"en"})',
		),
	);
	assert(reply._tag === "success" && reply.envelope, "Key library read failed");
	return reply.envelope;
}
async function scenario(name: string, run: () => Promise<void>) {
	try {
		await run();
		results.push({ page: "keys", control: name, status: "passed" });
	} catch (cause) {
		results.push({
			page: "keys",
			control: name,
			status: "failed",
			reason: message(cause),
		});
	}
	process.stdout.write(
		`Scenario ${name}: ${results.at(-1)?.status} ${results.at(-1)?.reason ?? ""}\n`,
	);
}
async function chooseKey(win: BrowserWindow, code: string) {
	const selector = `.keys-cells [data-drop-code="${code}"]`;
	if (
		await evaluate(
			win,
			`document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-pressed') !== 'true'`,
		)
	)
		await click(win, selector);
	await waitFor(
		win,
		`!!document.querySelector('#key-title') && document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-pressed')==='true'`,
		`properties for ${code}`,
	);
}
async function targeted(win: BrowserWindow) {
	await navigate(win, "keys");
	await waitFor(
		win,
		"!!document.querySelector('#keys-profile')",
		"Keys editor",
	);
	await scenario(
		"Active-on-device profile persists and renders in panel",
		async () => {
			await select(win, "#keys-profile", "1-2");
			await select(win, "#keys-profile", "exercise-keys");
			const saved = await readKeys(win);
			assert.equal(
				saved.activeByDevice["desktop-preview"]?.profileId,
				"exercise-keys",
				"activeByDevice didn't change after real selector input",
			);
			const panel = BrowserWindow.getAllWindows().find((window) =>
				window.webContents.getURL().includes("surface=panel"),
			);
			assert(panel, "Missing production panel");
			await waitFor(
				panel,
				"document.querySelector('.strip-panel')?.textContent?.includes('Exercise A')",
				"panel selected profile title",
			);
			await capture(panel, "panel-selected-profile");
		},
	);
	await select(win, "#keys-profile", "exercise-keys");
	await scenario("Icon library opens from Keys [open-quake-di9]", async () => {
		await chooseKey(win, "1,4");
		const selector = await evaluate(
			win,
			`(()=>{const b=Array.from(document.querySelectorAll('.key-editor button')).find(el=>/^Icon Library$/i.test(el.textContent.trim()));if(!b)throw new Error('Missing Icon Library button');b.dataset.exerciseId='target-icons';return '[data-exercise-id="target-icons"]'})()`,
		);
		assert.equal(typeof selector, "string");
		await click(win, String(selector));
		// The Icon Library is an owned child window at surface=icons (icon-picker.ts).
		let picker: BrowserWindow | undefined;
		for (let waited = 0; !picker && waited < 5000; waited += 100) {
			picker = BrowserWindow.getAllWindows().find(
				(window) =>
					window.getParentWindow() === win &&
					new URL(
						window.webContents.getURL() || "about:blank",
					).searchParams.get("surface") === "icons",
			);
			if (!picker) await delay(100);
		}
		assert(picker, "Icon Library did not open from native input");
		await waitFor(
			picker,
			"document.querySelector('.icon-library-body[aria-busy=false]') && document.querySelectorAll('.icon-library-cell').length > 0",
			"loaded icon library cells",
		);
		await capture(picker, "keys-icon-library");
		picker.close();
	});
	// Preserve built-in editing flags in this sparse copied resource. They caused the reported bugs.
	for (const [name, destination] of [
		["Move key to empty cell [open-quake-fb9]", "1,8"],
		["Swap two keys [open-quake-fb9]", "1,5"],
	] as const) {
		await scenario(name, async () => {
			await chooseKey(win, "1,4");
			const disabled = await evaluate(
				win,
				"document.querySelector('#key-destination')?.disabled",
			);
			const before = await readKeys(win);
			const original = before.profiles
				.find((p) => p.id === "exercise-keys")
				?.pages[0].keys.find((k) => k.keyCode === "1,4");
			assert(original);
			await select(win, "#key-destination", destination);
			await click(win, ".key-editor .group:has(#key-title) .button-primary");
			await delay(300);
			const saved = await readKeys(win);
			const persisted = saved.profiles.find((p) => p.id === "exercise-keys")
				?.pages[0].keys;
			assert.equal(
				persisted?.find((k) => k.keyCode === destination)?.config.title.text,
				original.config.title.text,
				`Key order unchanged; destination selector disabled=${String(disabled)}`,
			);
			if (destination === "1,5")
				assert.equal(
					persisted?.find((k) => k.keyCode === "1,4")?.config.title.text,
					"Exercise B",
					"Swap didn't preserve the other key",
				);
		});
	}
	await scenario(
		"Rename Luminance and persist title [open-quake-efm]",
		async () => {
			await chooseKey(win, "1,1");
			const disabled = await evaluate(
				win,
				"document.querySelector('#key-title')?.disabled",
			);
			if (!disabled) await textInput(win, "#key-title", "Light test");
			await click(win, ".key-editor .group:has(#key-title) .button-primary");
			await delay(300);
			const saved = await readKeys(win);
			assert.equal(
				saved.profiles
					.find((p) => p.id === "exercise-keys")
					?.pages[0].keys.find((k) => k.keyCode === "1,1")?.config.title.text,
				"Light test",
				`Luminance title unchanged; input disabled=${String(disabled)}`,
			);
		},
	);

	await scenario(
		"Editable wide key moves to an empty cell through IPC",
		async () => {
			await select(win, "#keys-profile", "exercise-move");
			await chooseKey(win, "1,4");
			await select(win, "#key-destination", "1,1");
			await click(win, ".key-editor .group:has(#key-title) .button-primary");
			await waitFor(
				win,
				"document.querySelector('.key-editor')?.getAttribute('aria-busy')==='false'",
				"move save completion",
			);
			const saved = await readKeys(win);
			const keys = saved.profiles.find((p) => p.id === "exercise-move")
				?.pages[0].keys;
			assert.equal(
				keys?.find((k) => k.keyCode === "1,1")?.config.title.text,
				"Move A",
				"Editable key didn't persist at empty destination",
			);
			assert(
				!keys?.some((k) => k.keyCode === "1,4"),
				"Move left the source occupied",
			);
		},
	);
	await scenario(
		"Editable wide keys swap at a covered cell [open-quake-fb9]",
		async () => {
			await select(win, "#keys-profile", "exercise-move");
			const before = await readKeys(win);
			const source = before.profiles
				.find((p) => p.id === "exercise-move")
				?.pages[0].keys.find((k) => k.config.title.text === "Move A");
			assert(source);
			await chooseKey(win, source.keyCode);
			await select(win, "#key-destination", "2,7");
			await click(win, ".key-editor .group:has(#key-title) .button-primary");
			await waitFor(
				win,
				"document.querySelector('.key-editor')?.getAttribute('aria-busy')==='false'",
				"swap save completion",
			);
			const saved = await readKeys(win);
			const keys = saved.profiles.find((p) => p.id === "exercise-move")
				?.pages[0].keys;
			assert.equal(
				keys?.find((k) => k.keyCode === "2,8")?.config.title.text,
				"Move A",
				"Covered-cell swap didn't move to the occupied key's anchor",
			);
			assert.equal(
				keys?.find((k) => k.keyCode === source.keyCode)?.config.title.text,
				"Move B",
				"Swap didn't preserve the other key",
			);
		},
	);
	await select(win, "#keys-profile", "exercise-keys");
	await capture(win, "keys-targeted");
	await writeFile(
		join(directory, "targeted.json"),
		JSON.stringify(results, null, 2),
	);
}
async function finish() {
	if (finished) return;
	finished = true;
	const diagnosticErrors: unknown[] = [];
	for (const file of await readdir(join(userData, "diagnostics")).catch(
		() => [],
	)) {
		if (!file.endsWith(".ndjson")) continue;
		for (const line of (
			await readFile(join(userData, "diagnostics", file), "utf8")
		)
			.split("\n")
			.slice(0, -1)) {
			if (!line) continue;
			const entry: unknown = JSON.parse(line);
			if (
				typeof entry === "object" &&
				entry !== null &&
				"pino_level" in entry &&
				typeof entry.pino_level === "number" &&
				entry.pino_level >= 50
			)
				diagnosticErrors.push(entry);
		}
	}
	const diagnosticGroups = new Map<
		string,
		{ count: number; reason: string; expected: boolean }
	>();
	for (const entry of diagnosticErrors) {
		if (typeof entry !== "object" || entry === null || !("span_name" in entry))
			continue;
		const name = String(entry.span_name);
		const expected = [
			"ObsService.connect",
			"ObsService.connectUnlocked",
		].includes(name);
		const reason = expected
			? "Fresh scratch profile has no configured OBS endpoint"
			: JSON.stringify("cause" in entry ? entry.cause : "main error");
		const previous = diagnosticGroups.get(name);
		diagnosticGroups.set(name, {
			count: (previous?.count ?? 0) + 1,
			reason,
			expected,
		});
	}
	for (const [name, diagnostic] of diagnosticGroups)
		if (!diagnostic.expected)
			results.push({
				page: "main",
				control: name,
				status: "failed",
				reason: `${diagnostic.count} main diagnostic errors: ${diagnostic.reason}`,
			});
	const summary = {
		pages: visited.length,
		discoveredPages: pages.length,
		records: results.length,
		controls: results.filter((r) => r.identity !== undefined).length,
		exercised: results.filter(
			(r) =>
				r.identity !== undefined && ["passed", "failed"].includes(r.status),
		).length,
		passed: results.filter((r) => r.status === "passed").length,
		failed: results.filter((r) => r.status === "failed").length,
		skipped: results.filter((r) => r.status === "skipped").length,
		expectedInert: results.filter((r) => r.status === "expected-inert").length,
		errors: errors.length,
	};
	await writeFile(
		join(directory, "report.json"),
		JSON.stringify(
			{
				summary,
				pages,
				visited,
				diagnosticErrors,
				diagnosticGroups: Object.fromEntries(diagnosticGroups),
				results,
				errors,
				registered,
				invocations: Object.fromEntries(invocations),
				rejected: mainReplies,
				policy: {
					skip: skipRules.map((r) => ({
						pattern: r.pattern.source,
						reason: r.reason,
					})),
					expectedInert,
				},
				userData,
				fixtureOnly: true,
			},
			null,
			2,
		),
		{ mode: 0o600 },
	);
	process.stdout.write(
		`Management exerciser ${JSON.stringify(summary)}\nReport: ${join(directory, "report.json")}\n`,
	);
	for (const failure of results.filter((r) => r.status === "failed"))
		process.stdout.write(
			`FAIL ${failure.page}: ${failure.control}: ${failure.reason}\n`,
		);
	app.exit(summary.failed || summary.errors ? 1 : 0);
}
async function run() {
	await app.whenReady();
	let win: BrowserWindow | undefined;
	const end = Date.now() + 30000;
	while (!win && Date.now() < end) {
		win = BrowserWindow.getAllWindows().find(
			(window) =>
				window.webContents.getURL().includes("surface=management") &&
				!window.webContents.isLoading(),
		);
		if (!win) await delay(100);
	}
	assert(win, "Production composition root didn't create management window");
	win.setSize(1440, 1100);
	await waitFor(
		win,
		"!!document.querySelector('nav .nav-item')",
		"management sidebar",
	);
	pages = Schema.decodeUnknownSync(Schema.Array(Schema.String))(
		await evaluate(
			win,
			"Array.from(document.querySelectorAll('nav .nav-item[data-nav-page]')).map(el=>el.dataset.navPage)",
		),
	);
	assert(pages.length >= 13, "Incomplete management sidebar");
	await targeted(win).catch((cause: unknown) =>
		results.push({
			page: "keys",
			control: "scenario setup",
			status: "failed",
			reason: message(cause),
		}),
	);

	for (const page of pages) {
		try {
			if (page === "connection") {
				assert(managementExerciserBus, "Missing fixture fake bus");
				managementExerciserBus.emitStatus({
					source: "mock",
					kind: "status",
					state: "disconnected",
					reason: "requested",
				});
				await delay(500);
			}
			await navigate(win, page);
			visited.push(page);
			await capture(win, `page-${page}`);
			await evaluate(
				win,
				`window.managementExerciseInitialRows=Array.from(document.querySelectorAll('.profile-columns ul')).map(list=>list.children.length)`,
			);
			const seen = new Set<string>();
			// Large generated dialogs (e.g. emoji grids) get a bounded sample.
			let dialogControls = 0;
			// Re-enumerate after each action to include controls revealed by tabs/details/dialogs.
			for (let count = 0; count < 600; count++) {
				const controls = (await evaluate(
					win,
					`(${enumerateControls.toString()})()`,
				)) as Control[];
				const control = controls.find((control) => !seen.has(control.identity));
				if (!control) break;
				seen.add(control.identity);
				if (control.inDialog && ++dialogControls > 40) {
					await closeDialogs(win);
					dialogControls = 0;
					continue;
				}
				await exercise(win, page, control);
				if (control.restoreRadio && !control.selected && !skipReason(control))
					await click(win, control.restoreRadio);
				// Toggle filters (aria-pressed) would otherwise hide later controls.
				if (
					control.pressed !== null &&
					!skipReason(control) &&
					(await evaluate(
						win,
						`document.querySelector(${JSON.stringify(selectorFor(control))})?.getAttribute('aria-pressed') ?? null`,
					)) !== control.pressed
				)
					await click(win, selectorFor(control));
				if (
					control.tag === "select" &&
					!control.disabled &&
					control.value &&
					(await evaluate(
						win,
						`!!document.querySelector(${JSON.stringify(selectorFor(control))})`,
					))
				) {
					await select(win, selectorFor(control), control.value, false).catch(
						(cause: unknown) =>
							results.push({
								page,
								control: `Restore ${control.label}`,
								status: "failed",
								reason: message(cause),
							}),
					);
				}
				if (
					["input", "textarea"].includes(control.tag) &&
					![
						"checkbox",
						"radio",
						"range",
						"button",
						"submit",
						"file",
						"color",
						"password",
					].includes(control.type) &&
					!skipReason(control) &&
					(await evaluate(
						win,
						`!!document.querySelector(${JSON.stringify(selectorFor(control))})`,
					))
				) {
					await textInput(win, selectorFor(control), control.value).catch(
						(cause: unknown) =>
							results.push({
								page,
								control: `Restore ${control.label}`,
								status: "failed",
								reason: message(cause),
							}),
					);
				}

				if (count % 25 === 24)
					process.stdout.write(
						`Page ${page}: ${count + 1} controls discovered\n`,
					);
				// Close fixture-created sheets after their opening has been observed.
				for (const window of BrowserWindow.getAllWindows())
					if (
						window !== win &&
						/surface=(icon-picker|settings)/.test(window.webContents.getURL())
					)
						window.close();
				if (
					await evaluate(
						win,
						`document.querySelector('.nav-item[aria-current="page"]')?.dataset.navPage !== ${JSON.stringify(page)}`,
					)
				)
					await navigate(win, page);
				if (count === 599)
					results.push({
						page,
						control: "enumeration",
						status: "failed",
						reason: "Control exploration exceeded 600 states",
					});
			}
			process.stdout.write(`Exercised page ${page}\n`);
		} catch (cause) {
			results.push({
				page,
				control: "page exploration",
				status: "failed",
				reason: message(cause),
			});
		} finally {
			if (page === "connection") {
				managementExerciserBus?.emitStatus({
					source: "mock",
					kind: "status",
					state: "connected",
				});
				await delay(500);
			}
		}
	}
	const persisted: unknown = JSON.parse(
		await readFile(join(userData, "profiles-v1.json"), "utf8"),
	);
	assert(
		Schema.is(Schema.encodedSchema(ProfileEnvelope))(persisted),
		"Persisted store is invalid",
	);
	assert(
		BrowserWindow.getAllWindows().every(
			(window) => !window.isVisible() && !window.isFocused(),
		),
		"Fixture exposed a native window",
	);
}
async function prepare() {
	await mkdir(userData, { recursive: true, mode: 0o700 });
	app.setPath("userData", userData);
	app.setPath("sessionData", userData);
	if (process.platform === "darwin") app.setActivationPolicy("prohibited");
	const builtins = builtinProfiles(
		process.platform === "darwin"
			? "darwin"
			: process.platform === "win32"
				? "win32"
				: "linux",
	);
	const quick = builtins.find((profile) => profile.id === "1-2");
	assert(quick);
	const sparse = {
		...quick,
		id: "exercise-keys",
		name: "Exercise",
		pages: [
			{
				...quick.pages[0],
				keys: quick.pages[0].keys
					.filter((key) => ["1,1", "1,4", "1,5"].includes(key.keyCode))
					.map((key) =>
						key.keyCode === "1,1"
							? key
							: {
									...key,
									config: {
										...key.config,
										title: {
											...key.config.title,
											text: key.keyCode === "1,4" ? "Exercise A" : "Exercise B",
										},
									},
								},
					),
			},
		] as const,
	};
	const movable = {
		...sparse,
		id: "exercise-move",
		name: "Move test",
		compatibility: Option.none(),
		pages: [
			{
				...sparse.pages[0],
				keys: sparse.pages[0].keys
					.filter((key) => key.config.type === "website")
					.map((key, index) => ({
						...key,
						keyCode: index === 0 ? "1,4" : "2,8",
						config: {
							...key.config,
							basicEditableItems: Option.none(),
							size: [2, 1] as const,
							title: {
								...key.config.title,
								text: index === 0 ? "Move A" : "Move B",
							},
						},
					})),
			},
		] as const,
	};
	const first = builtins[0];
	assert(first);
	const envelope = {
		manager: Option.none(),
		schemaVersion: 1 as const,
		profiles: [first, ...builtins.slice(1), sparse, movable] as const,
		activeByDevice: {
			"desktop-preview": {
				profileId: sparse.id,
				pageId: sparse.pages[0].id,
			},
		},
	};
	await writeFile(
		join(userData, "profiles-v1.json"),
		JSON.stringify(encodeProfileEnvelope(envelope)),
		{ flag: "wx", mode: 0o600 },
	);
	// Start run without awaiting ready: index.ts must register privileged schemes before ready.
	void run()
		.catch((cause: unknown) =>
			results.push({
				page: "fixture",
				control: "run",
				status: "failed",
				reason: message(cause),
			}),
		)
		.finally(finish);
	await import("../index");
}
const deadline = setTimeout(() => {
	results.push({
		page: "fixture",
		control: "deadline",
		status: "failed",
		reason: "Exceeded 10 minute deadline",
	});
	void finish();
}, 600000);
app.once("will-quit", () => clearTimeout(deadline));
process.once("SIGTERM", () => {
	results.push({
		page: "fixture",
		control: "interrupted",
		status: "failed",
		reason: "Fixture interrupted",
	});
	void finish();
});
await prepare().catch(async (cause: unknown) => {
	results.push({
		page: "fixture",
		control: "startup",
		status: "failed",
		reason: message(cause),
	});
	await finish();
});
