/** Deterministic mounted-editor regressions. All host effects are recorded mocks. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	Deferred,
	Effect,
	Array as EffectArray,
	Layer,
	Option,
	Schema,
} from "effect";
import { type BrowserWindow, ipcMain } from "electron";
import { executeActionLeaf } from "../../../../../packages/device/src/actions/action-service.js";
import {
	KeyRuntime,
	KeyRuntimePort,
} from "../../../../../packages/device/src/actions/key-runtime-service.js";
import {
	createEmptyProfileKey,
	Profile,
	ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { ProfileRepository } from "../../../../../packages/device/src/profiles/profile-repository.js";
import {
	KEY_REQUEST,
	type KeyReply,
	KeyRequest,
} from "../../shared/key-library";
import type { registerProfiles } from "../profiles";

type Phase = "before" | "after";
export function interceptEditorRequests() {
	const original = ipcMain.handle;
	const pauses: {
		type: KeyRequest["type"];
		phase: Phase;
		enter: () => void;
		released: Promise<void>;
	}[] = [];
	const requests: KeyRequest[] = [];
	const releases: (() => void)[] = [];
	ipcMain.handle = (channel, handler) =>
		original.call(
			ipcMain,
			channel,
			channel !== KEY_REQUEST
				? handler
				: async (event, input: unknown) => {
						const command = Schema.decodeUnknownSync(KeyRequest)(input);
						requests.push(command);
						const pause = async (phase: Phase) => {
							const index = pauses.findIndex(
								(p) => p.type === command.type && p.phase === phase,
							);
							if (index < 0) return;
							const barrier = pauses.splice(index, 1)[0];
							if (barrier) {
								barrier.enter();
								await barrier.released;
							}
						};
						await pause("before");
						const reply: KeyReply = await handler(event, input);
						await pause("after");
						return reply;
					},
		);
	return {
		requests,
		releaseAll: () => {
			for (const release of releases) release();
		},
		restore: () => {
			ipcMain.handle = original;
		},
		pause: (type: KeyRequest["type"], phase: Phase) => {
			let release = () => {};
			let enter = () => {};
			const entered = new Promise<void>((done) => {
				enter = done;
			});
			const released = new Promise<void>((done) => {
				release = done;
			});
			releases.push(release);
			pauses.push({ type, phase, enter, released });
			return { entered, release };
		},
	};
}

type Harness = {
	manager: BrowserWindow;
	profiles: ReturnType<typeof registerProfiles>;
	scratch: string;
	delays: ReturnType<typeof interceptEditorRequests>;
	evalIn: (win: BrowserWindow, source: string) => Promise<unknown>;
	ready: (win: BrowserWindow, expression: string) => Promise<void>;
	click: (win: BrowserWindow, selector: string) => Promise<void>;
	button: (win: BrowserWindow, text: string) => Promise<void>;
	input: (win: BrowserWindow, selector: string, value: string) => Promise<void>;
	select: (
		win: BrowserWindow,
		selector: string,
		value: string,
	) => Promise<void>;
	snapshot: (win: BrowserWindow, name: string) => Promise<void>;
};
export async function verifyEditorTransactions(h: Harness): Promise<void> {
	const {
		manager: win,
		profiles,
		delays,
		evalIn,
		ready,
		click,
		button,
		input,
		select,
		snapshot,
	} = h;
	const fixtureKey = (code: string, type: string) => {
		const empty = Schema.encodeSync(ProfileKey)(createEmptyProfileKey(code));
		return {
			...empty,
			childrenName: type,
			config: {
				...empty.config,
				type,
				title: { ...empty.config.title, text: "Initial", display: true },
				actions: type === "hotkey" ? [{ type: "key", value: "a" }] : [],
				...(type === "multiActions"
					? {
							subActions: [
								{
									vendorStep: { retained: true },
									config: {
										type: "text",
										gap: 0,
										vendorConfig: { retained: true },
										actions: [
											{ type: "text", value: "Before" },
											{ type: "key", value: "enter" },
										],
									},
								},
							],
						}
					: {}),
			},
		};
	};
	const fixture = Schema.decodeUnknownSync(Profile)({
		id: "editor-races",
		name: "Editor regressions",
		revision: 0,
		pages: [
			{
				id: "one",
				keys: [fixtureKey("1,1", "hotkey"), fixtureKey("1,2", "multiActions")],
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
	const profile = async () => {
		const p = (await committed()).envelope.profiles.find(
			(p) => p.id === fixture.id,
		);
		assert(p);
		return p;
	};
	const title = () => evalIn(win, "document.querySelector('#key-title').value");
	const settled = () =>
		ready(
			win,
			"document.querySelector('.key-editor')?.getAttribute('aria-busy') !== 'true' && document.body.innerText.includes('Saved successfully')",
		);
	const released = async (barrier: ReturnType<typeof delays.pause>) => {
		await Promise.race([
			barrier.entered,
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error("IPC barrier not reached")), 8000),
			),
		]);
	};
	await select(win, "#keys-profile", fixture.id);
	await click(win, ".keys-cells button:first-child");
	await ready(win, "document.querySelector('#key-title')");
	await input(win, "#key-title", "Save transaction");
	const revision = (await profile()).revision;
	const before = delays.pause("preview", "before");
	const after = delays.pause("save", "after");
	await button(win, "Save");
	await released(before);
	try {
		// Assert actual Chromium disabled behavior, then try the same-key edit and related mutations.
		assert(
			await evalIn(
				win,
				"Array.from(document.querySelectorAll('.key-editor input,.key-editor select,.key-editor button')).every(el=>el.matches(':disabled'))",
			),
			"all editor mutations must be disabled from the first preview through the save reply",
		);
		const start = delays.requests.length;
		await input(win, "#key-title", "Should be blocked");
		await click(win, ".keys-cells button:nth-child(2)");
		await button(win, "Save");
		await button(win, "Cancel");
		await evalIn(
			win,
			"document.body.focus();window.dispatchEvent(new KeyboardEvent('keyup',{key:'Delete',bubbles:true}));document.querySelector('nav').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));true",
		);
		assert.equal(await title(), "Save transaction");
		assert.equal(
			delays.requests.length,
			start,
			"disabled edits, double Save, selection, Cancel, Delete and click-away must not issue mutations",
		);
		await snapshot(win, "save-preview-pending");
	} finally {
		before.release();
	}
	await released(after);
	try {
		assert(
			await evalIn(
				win,
				"document.querySelector('#key-title').matches(':disabled')",
			),
		);
		await input(win, "#key-title", "Also blocked after commit");
		assert.equal(await title(), "Save transaction");
		await snapshot(win, "save-response-pending");
	} finally {
		after.release();
	}
	await settled();
	assert.equal(
		(await profile()).revision,
		revision + 1,
		"one Save must commit once",
	);
	assert.equal(
		(await profile()).pages[0]?.keys.find((k) => k.keyCode === "1,1")?.config
			.title.text,
		"Save transaction",
	);
	// Once unlocked, the same key uses the returned revision and accepts a new draft/save.
	await input(win, "#key-title", "Saved title");
	await button(win, "Save");
	await settled();
	assert.equal((await profile()).revision, revision + 2);
	assert.equal(
		(await profile()).pages[0]?.keys.find((k) => k.keyCode === "1,1")?.config
			.title.text,
		"Saved title",
	);

	// A mounted Value edit goes through preview, Save, persistence and the real runtime/leaf consumers.
	await click(win, ".keys-cells button:nth-child(2)");
	await ready(win, "document.querySelector('.key-sequence-step input')");
	await input(win, ".key-sequence-step input", "After");
	await button(win, "Save");
	await settled();
	const saved = (await committed()).envelope;
	const savedStep = (await profile()).pages[0]?.keys.find(
		(k) => k.keyCode === "1,2",
	)?.config.subActions;
	assert(savedStep && Option.isSome(savedStep));
	assert.deepEqual(JSON.parse(JSON.stringify(savedStep.value[0]?.config)), {
		type: "text",
		gap: 0,
		vendorConfig: { retained: true },
		actions: [
			{ type: "text", value: "After" },
			{ type: "key", value: "enter" },
		],
	});
	assert.deepEqual(JSON.parse(JSON.stringify(savedStep.value[0]?.vendorStep)), {
		retained: true,
	});
	const calls: string[] = [];
	await Effect.runPromise(
		Effect.gen(function* () {
			const done = yield* Deferred.make<void>();
			const port = Layer.succeed(KeyRuntimePort, {
				read: Effect.succeed({
					...saved,
					activeByDevice: {
						"desktop-preview": { profileId: fixture.id, pageId: "one" },
					},
				}),
				execute: (config) =>
					executeActionLeaf(config, {
						keyboard: Option.some({
							supportedTokens: new Set(["enter"]),
							pressChord: (chord) =>
								Effect.sync(() => {
									calls.push(`key:${chord}`);
								}),
						}),
						text: Option.some({
							insertText: (text) =>
								Effect.sync(() => {
									calls.push(`text:${text}`);
								}),
						}),
						website: Option.none(),
						application: Option.none(),
						media: Option.none(),
					}),
				publish: (state) =>
					state.progress === 100
						? Deferred.succeed(done, undefined).pipe(Effect.asVoid)
						: Effect.void,
				select: () => Effect.void,
				alarm: () => Effect.void,
			});
			yield* Effect.gen(function* () {
				yield* KeyRuntime.activate("desktop-preview", "1,2", "press");
				yield* Deferred.await(done).pipe(Effect.timeout("5 seconds"));
			}).pipe(
				Effect.provide(
					KeyRuntime.DefaultWithoutDependencies.pipe(Layer.provide(port)),
				),
				Effect.scoped,
			);
		}),
	);
	assert.deepEqual(calls, ["text:After", "key:enter"]);
	await snapshot(win, "sequence-enter-retained");

	// Unmount while the final preview is delayed: no subsequent Save may be submitted.
	await click(win, ".keys-cells button:first-child");
	await input(win, "#key-title", "Unmount before Save");
	const initialRevision = (await profile()).revision;
	const unmountPreview = delays.pause("preview", "before");
	const savesBefore = delays.requests.filter((r) => r.type === "save").length;
	await button(win, "Save");
	await released(unmountPreview);
	await button(win, "Appearance");
	unmountPreview.release();
	await ready(win, "!document.querySelector('.key-editor')");
	await button(win, "Keys");
	await ready(win, "document.querySelector('#keys-profile')");
	await select(win, "#keys-profile", fixture.id);
	await click(win, ".keys-cells button:nth-child(2)");
	assert.equal(
		delays.requests.filter((r) => r.type === "save").length,
		savesBefore,
	);
	assert.equal((await profile()).revision, initialRevision);

	// Unmount after commit while its response is delayed, then switch key in a fresh editor.
	await click(win, ".keys-cells button:first-child");
	await input(win, "#key-title", "Saved on unmount");
	const oldReply = delays.pause("save", "after");
	await button(win, "Save");
	await released(oldReply);
	await button(win, "Appearance");
	await button(win, "Keys");
	await ready(win, "document.querySelector('#keys-profile')");
	await select(win, "#keys-profile", fixture.id);
	await click(win, ".keys-cells button:nth-child(2)");
	await input(win, "#key-title", "New key draft");
	oldReply.release();
	await ready(
		win,
		"document.querySelector('#key-title')?.value === 'New key draft'",
	);
	await button(win, "Save");
	await settled();
	assert.equal(
		(await profile()).pages[0]?.keys.find((k) => k.keyCode === "1,1")?.config
			.title.text,
		"Saved on unmount",
	);
	assert.equal(
		(await profile()).pages[0]?.keys.find((k) => k.keyCode === "1,2")?.config
			.title.text,
		"New key draft",
	);
	await snapshot(win, "save-unmount-new-key");
	// A revision conflict rejects visibly, unlocks controls and preserves the draft.
	await input(win, "#key-title", "Conflict draft");
	const conflict = delays.pause("preview", "before");
	const savesAtConflict = delays.requests.filter(
		(r) => r.type === "save",
	).length;
	await button(win, "Save");
	await released(conflict);
	await profiles.runtime.runPromise(
		Effect.flatMap(ProfileRepository, (repo) =>
			repo.transact((env) =>
				Effect.succeed({
					...env,
					profiles: EffectArray.map(env.profiles, (p) =>
						p.id === fixture.id ? { ...p, revision: p.revision + 1 } : p,
					),
				}),
			),
		),
	);
	conflict.release();
	await ready(
		win,
		"document.querySelector('.key-editor')?.getAttribute('aria-busy') === 'false' && !document.querySelector('#key-title').matches(':disabled')",
	);
	assert.equal(await title(), "Conflict draft");
	assert.equal(
		delays.requests.filter((r) => r.type === "save").length,
		savesAtConflict,
	);
	assert.equal(
		(await profile()).pages[0]?.keys.find((k) => k.keyCode === "1,2")?.config
			.title.text,
		"New key draft",
	);
	assert(
		await evalIn(
			win,
			"document.querySelector('.key-editor > [role=status]')?.textContent?.includes('QUAKE.PROFILE.REVISION_CONFLICT')",
		),
	);
	await snapshot(win, "save-conflict-retains-draft");
	await writeFile(
		join(h.scratch, "editor-regressions.json"),
		JSON.stringify(
			{
				sequenceCalls: calls,
				requests: delays.requests,
				finalProfile: Schema.encodeSync(Profile)(await profile()),
				proofs: [
					"preview/save disabled controls",
					"same-key edit blocked",
					"double Save single commit",
					"Delete/click-away/Cancel guarded",
					"new revision accepts next edit",
					"Value/save/runtime preserves Enter",
					"unmount before save cancels commit",
					"unmount after commit cannot overwrite switched key",
					"revision conflict unlocks and retains draft",
				],
			},
			null,
			2,
		),
	);
	process.stdout.write(
		"Mounted editor regressions PASS: delayed preview/save, mutation exclusion, double Save, unmount/switch, sequence input/save/text/Enter.\n",
	);
}
