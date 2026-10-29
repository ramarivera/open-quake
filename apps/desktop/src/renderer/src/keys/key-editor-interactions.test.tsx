// @vitest-environment happy-dom
import {
	Effect,
	Array as EffectArray,
	Layer,
	ManagedRuntime,
	Option,
	Schema,
} from "effect";
import { GTProvider } from "gt-react";
import { act, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
	KeyRuntime,
	KeyRuntimePort,
} from "../../../../../../packages/device/src/actions/key-runtime-service";
import { actionProfileFunctionContracts } from "../../../../../../packages/device/src/actions/profile-function-contracts";
import { saveProfileKnob } from "../../../../../../packages/device/src/knob/knob-profile";
import {
	AppLibrarySnapshot,
	defaultAppLibrary,
} from "../../../../../../packages/device/src/profiles/app-library";
import { keyText } from "../../../../../../packages/device/src/profiles/key-editing-invariants";
import { KeyEditing } from "../../../../../../packages/device/src/profiles/key-editing-service";
import {
	builtinProfiles,
	profileLabel,
} from "../../../../../../packages/device/src/profiles/profile-catalog";
import {
	createEmptyProfileKey,
	encodeProfileEnvelope,
	Profile,
	ProfileEnvelope,
	ProfileKey,
} from "../../../../../../packages/device/src/profiles/profile-contracts";
import {
	profileFunctionContractsLayer,
	profileKeyFunctionIssues,
} from "../../../../../../packages/device/src/profiles/profile-function-contracts";
import { inspectProfileText } from "../../../../../../packages/device/src/profiles/profile-import";
import {
	ProfileRepository,
	profileStorageLayer,
} from "../../../../../../packages/device/src/profiles/profile-repository";
import { ProfileService } from "../../../../../../packages/device/src/profiles/profile-service";
import { initialAgentState } from "../../../../../../packages/edge/src/agents/agents-invariants";
import { managementProfileContracts } from "../../../main/management/profile-contracts";
import type { QuakeEvent } from "../../../preload/quake";
import type {
	ClockCommand,
	ClockSnapshot,
} from "../../../shared/clock-contracts";
import { defaultClockTile, defaultWallpaper } from "../../../shared/display";
import type {
	KeyPreview,
	KeyReply,
	KeyRequest,
} from "../../../shared/key-library";
import type { MeetingsBridge } from "../../../shared/meeting-bridge";
import { readerSettings } from "../../../shared/reader-settings";
import { selectStripPage } from "../../../shared/strip-selection";
import type {
	WallpaperCommand,
	WallpaperSnapshot,
} from "../../../shared/wallpaper-contracts";
import { button, click, input, mount, query, settle } from "../../test/dom";
import { appDictionaries } from "../i18n";
import { stripLayout } from "../strip/geometry";
import { mountStripTouch } from "../strip/mount-strip-touch";
import {
	previewVoiceContext,
	type StripVoiceContext,
} from "../strip/overlays/voice/voice-context";
import { StripScreen } from "../strip/StripScreen";
import { patchClockEditorKey } from "../strip/tiles/clock/editorPatch";
import { IconPickerSurface } from "./IconPicker";
import { KeyEditor } from "./KeyEditor";
import { knobDraftRevision } from "./knob-draft";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
	localStorage.clear();
	vi.unstubAllGlobals();
});
async function fixture({
	locked = false,
	agentKey = false,
	knobKey = false,
	configure,
	appGroups = defaultAppLibrary(),
}: {
	appGroups?: AppLibrarySnapshot["groups"];
	locked?: boolean;
	agentKey?: boolean;
	knobKey?: boolean;
	configure?: (
		value: typeof ProfileEnvelope.Encoded,
	) => typeof ProfileEnvelope.Encoded;
} = {}) {
	let stored = Schema.encodeSync(ProfileEnvelope)(
		Schema.decodeUnknownSync(ProfileEnvelope)({
			schemaVersion: 1,
			profiles: [
				{
					id: "p",
					name: "Custom",
					revision: 0,
					pages: [
						{
							id: "one",
							keys: [
								{
									...Schema.encodeSync(ProfileKey)(
										createEmptyProfileKey("1,1"),
									),
									childrenName: agentKey
										? "clawbot"
										: knobKey
											? "text"
											: "multiActions",
									config: {
										...Schema.encodeSync(ProfileKey)(
											createEmptyProfileKey("1,1"),
										).config,
										type: agentKey
											? "clawbot"
											: knobKey
												? "text"
												: "multiActions",
										...(knobKey
											? { actions: [{ type: "text", value: "Ready" }] }
											: {}),
										...(agentKey
											? {
													actions: [
														{ type: "agentId", value: "main" },
														{ type: "voiceInput", value: true },
														{ type: "taskPrompt", value: "" },
													],
												}
											: {}),
										title: {
											...Schema.encodeSync(ProfileKey)(
												createEmptyProfileKey("1,1"),
											).config.title,
											text: "Sequence",
										},
										...(locked
											? { basicEditableItems: { allowDelete: false } }
											: {}),
										subActions: ["First", "Second", "Third"].map((text) => ({
											config: {
												type: "text",
												actions: [{ type: "text", value: text }],
											},
										})),
									},
								},
							],
						},
					],
				},
				{
					id: "other",
					name: "Other",
					revision: 0,
					pages: [{ id: "subfolder", keys: [] }],
				},
			],
			activeByDevice: { "desktop-preview": { profileId: "p", pageId: "one" } },
		}),
	);
	if (configure) stored = configure(stored);
	let writes = 0;
	let failWrites = false;
	let writePause: Promise<void> | undefined;
	const repository = ProfileRepository.DefaultWithoutDependencies.pipe(
		Layer.provide(
			Layer.mergeAll(
				profileFunctionContractsLayer(actionProfileFunctionContracts),
				profileStorageLayer({
					read: async () => stored,
					write: async (next) => {
						await writePause;
						if (failWrites) throw new Error("Synthetic disk failure");
						stored = next;
						writes++;
					},
				}),
			),
		),
	);
	const runtime = ManagedRuntime.make(
		KeyEditing.DefaultWithoutDependencies.pipe(
			Layer.provideMerge(
				ProfileService.DefaultWithoutDependencies.pipe(
					Layer.provideMerge(repository),
				),
			),
		),
	);
	cleanups.push(() => runtime.dispose());
	let publish: ((value: KeyPreview) => void) | undefined;
	const calls: KeyRequest[] = [];
	vi.stubGlobal("quakeAgents", {
		request: async () => ({
			_tag: "success",
			view: {
				...initialAgentState(),
				agents: [
					...initialAgentState().agents,
					{ id: "writer", name: "Writer", files: {}, emoji: "" },
				],
				models: {
					default: [
						{
							id: "fake-model",
							provider: "custom",
							model: "fake-model",
							maxTokens: 1024,
							baseUrl: "http://localhost:19999/v1",
							role: "default",
							credentialAvailable: false,
						},
					],
				},
				runtime: {
					available: false,
					status: "stopped",
					operation: "none",
					code: "",
				},
				progress: { percent: 0, stage: "idle", deviceApplied: false },
				draftingAvailable: false,
			},
			draft: "",
		}),
		onSnapshot: () => () => {},
		onProgress: () => () => {},
	});
	const request = async (command: KeyRequest): Promise<KeyReply> => {
		calls.push(command);
		const operation = Effect.gen(function* () {
			const editing = yield* KeyEditing;
			switch (command.type) {
				case "app-library.read":
					return {
						_tag: "success",
						appLibrary: Schema.encodeSync(AppLibrarySnapshot)({
							version: 1,
							revision: 1,
							groups: appGroups,
						}),
					} as const;
				case "inspect-import":
					return {
						_tag: "success",
						importReport: inspectProfileText(command.source),
					} as const;
				case "import-profile": {
					const envelope = yield* ProfileService.importProfile(
						command.source,
						"imported",
					);
					return {
						_tag: "success",
						envelope: encodeProfileEnvelope(envelope),
						importedProfileId: "imported",
					} as const;
				}
				case "select":
					yield* ProfileService.selectProfile({
						deviceId: command.deviceId,
						profileId: command.profileId,
						pageId: command.pageId,
					});
					break;
				case "preview": {
					const result = yield* editing.preview(
						command.target,
						command.key,
						command.geometry,
					);
					if (result._tag === "confirmation")
						return {
							_tag: "rejected",
							reason: "overlap-confirmation",
							keyCodes: result.keyCodes,
						} as const;
					if (result._tag !== "ready")
						return {
							_tag: "rejected",
							reason:
								result.reason === "locked"
									? "structural-key-locked"
									: "layout-locked-or-invalid",
						} as const;
					break;
				}
				case "save":
					yield* editing.save(command.token);
					break;
				case "revert":
					yield* editing.revert(command.token);
					break;
				case "delete":
					yield* editing.remove(command.target);
					break;
				case "add-page":
				case "delete-page":
					yield* ProfileService.editPages(command);
					break;
				case "save-knob":
					yield* saveProfileKnob(
						command.profileId,
						command.revision,
						command.knob,
					);
					break;
				case "read":
					break;
				default:
					return { _tag: "success" } as const;
			}
			const envelope = encodeProfileEnvelope(yield* editing.read());
			if (command.type !== "read") publish?.({ envelope });
			return { _tag: "success", envelope } as const;
		});
		const result = await runtime.runPromise(Effect.either(operation));
		return result._tag === "Right"
			? result.right
			: { _tag: "rejected", reason: result.left.code };
	};
	window.quakeKeyLibrary = {
		request,
		onPreview: (callback) => {
			publish = callback;
			return () => {
				publish = undefined;
			};
		},
		onRuntime: () => () => {},
	};
	let publishWallpaper: ((snapshot: unknown) => void) | undefined;
	const wallpaper = (serial: string): WallpaperSnapshot => ({
		saved: {
			version: 1,
			serial,
			revision: 0,
			settings: defaultWallpaper,
			clock: defaultClockTile,
		},
		asset: { _tag: "empty" },
		clock: { epochMillis: 0, hour: 0, minute: 0, second: 0 },
		recovered: false,
		normalizedFileUrl: false,
		deviceDelivery: "unverified",
	});
	const wallpaperCalls: WallpaperCommand[] = [];
	const managerCalls: unknown[] = [];
	// Activation succeeds with the stored envelope unless a test overrides it.
	let profileManagerReply: unknown;
	vi.stubGlobal("quakeProfileManager", {
		request: async (command: unknown) => {
			managerCalls.push(command);
			if (profileManagerReply !== undefined) return profileManagerReply;
			if (
				typeof command === "object" &&
				command !== null &&
				"command" in command &&
				typeof command.command === "object" &&
				command.command !== null &&
				"type" in command.command &&
				command.command.type === "select" &&
				"id" in command.command &&
				typeof command.command.id === "string"
			) {
				const selected = command.command.id;
				const profile = stored.profiles.find(
					(candidate) => candidate.id === selected,
				);
				if (profile) {
					for (const deviceId of new Set([
						"desktop-preview",
						...Object.keys(stored.activeByDevice),
					]))
						await runtime.runPromise(
							ProfileService.selectProfile({
								deviceId,
								profileId: selected,
								pageId: profile.pages[0].id,
							}),
						);
				}
			}
			return { _tag: "success", view: { envelope: stored } };
		},
	});
	vi.stubGlobal("quakeWallpaper", {
		request: async (command: WallpaperCommand) => {
			wallpaperCalls.push(command);
			return {
				_tag: "success",
				snapshot: wallpaper("desktop-preview"),
			};
		},
		onSnapshot: (callback: (snapshot: unknown) => void) => {
			publishWallpaper = callback;
			return () => {
				publishWallpaper = undefined;
			};
		},
		onClock: () => () => {},
	});
	const mounted = await mount(
		<GTProvider
			locale="en"
			translations={{ en: {}, de: {} }}
			dictionaries={appDictionaries}
			_reload={() => {}}
		>
			<KeyEditor />
		</GTProvider>,
	);
	cleanups.push(mounted.close);
	await settle(() =>
		expect(mounted.host.querySelector("#keys-profile")).not.toBeNull(),
	);
	const select = async () => {
		await click(button(mounted.host, "1,1"));
		await settle(() =>
			expect(mounted.host.querySelector("#key-title")).not.toBeNull(),
		);
	};
	return {
		...mounted,
		runtime,
		calls,
		wallpaperCalls,
		managerCalls,
		setProfileManagerReply: (reply: unknown) => {
			profileManagerReply = reply;
		},
		device: async (serial: string) => {
			await act(async () => publishWallpaper?.(wallpaper(serial)));
		},
		select,
		stored: () => stored,
		writes: () => writes,
		fail: (next: boolean) => {
			failWrites = next;
		},
		pauseWrite: () => {
			let release = () => {};
			writePause = new Promise<void>((resolve) => {
				release = resolve;
			});
			return release;
		},
		publish: async (envelope: typeof ProfileEnvelope.Encoded) => {
			await act(async () => publish?.({ envelope }));
		},
	};
}

it("switching the profile selector makes that profile active on the device", async () => {
	const f = await fixture({
		configure: (value) => ({
			...value,
			profiles: [
				...value.profiles,
				{ ...value.profiles[0], id: "q", name: "Second profile" },
			],
		}),
	});
	expect(f.host.textContent).toContain("Active on device");
	const selected = f.stored();
	f.setProfileManagerReply({
		_tag: "success",
		view: {
			envelope: {
				...selected,
				activeByDevice: {
					...selected.activeByDevice,
					"desktop-preview": { profileId: "q", pageId: "one" },
				},
			},
		},
	});
	const selector = query(f.host, "#keys-profile", HTMLSelectElement);
	await act(async () => {
		selector.value = "q";
		selector.dispatchEvent(new Event("change", { bubbles: true }));
	});
	await settle(() => expect(selector.value).toBe("q"));
	expect(
		f.managerCalls.filter((call) => {
			const command = call as {
				readonly type?: string;
				readonly command?: unknown;
			};
			return command.type === "manage";
		}),
	).toEqual([{ type: "manage", command: { type: "select", id: "q" } }]);
});

it("keeps the editor on the device's profile when activation is rejected", async () => {
	const f = await fixture({
		configure: (value) => ({
			...value,
			profiles: [
				...value.profiles,
				{ ...value.profiles[0], id: "q", name: "Second profile" },
			],
		}),
	});
	const before = query(f.host, "#keys-profile", HTMLSelectElement).value;
	f.setProfileManagerReply({ _tag: "rejected", reason: "offline" });
	const selector = query(f.host, "#keys-profile", HTMLSelectElement);
	await act(async () => {
		selector.value = "q";
		selector.dispatchEvent(new Event("change", { bubbles: true }));
	});
	await settle(() =>
		expect(f.host.textContent).toContain(
			"This profile could not be made active on the device.",
		),
	);
	expect(query(f.host, "#keys-profile", HTMLSelectElement).value).toBe(before);
});

it("MGMT-079 / MGMT-083 commits removal of the selected middle operation and retains the other operations", async () => {
	const f = await fixture();
	await f.select();
	const steps = f.host.querySelectorAll(".key-sequence-step");
	expect(steps).toHaveLength(3);
	await click(button(steps[1] ?? f.host, "Delete"));
	await click(button(f.host, "Save"));
	await settle(() =>
		expect(f.host.textContent).toContain("Saved successfully"),
	);
	const committed = f.stored().profiles[0].pages[0].keys[0];
	expect(committed?.config.subActions?.map((step) => step.config)).toEqual([
		expect.objectContaining({ actions: [{ type: "text", value: "First" }] }),
		expect.objectContaining({ actions: [{ type: "text", value: "Third" }] }),
	]);
	expect(f.calls.filter((c) => c.type === "save")).toHaveLength(1);
	expect(
		encodeProfileEnvelope(
			(await f.runtime.runPromise(ProfileService.loadProfiles())).envelope,
		),
	).toEqual(f.stored());
});

it("MGMT-079 keeps the draft and persisted revision intact after a failed write, then allows retry", async () => {
	const f = await fixture();
	await f.select();
	await input(query(f.host, "#key-title", HTMLInputElement), "Draft title");
	const before = f.stored();
	f.fail(true);
	await click(button(f.host, "Save"));
	await settle(() =>
		expect(f.host.textContent).toContain("QUAKE.PROFILE.WRITE_FAILED"),
	);
	expect(f.stored()).toEqual(before);
	expect(query(f.host, "#key-title", HTMLInputElement).value).toBe(
		"Draft title",
	);
	f.fail(false);
	await click(button(f.host, "Save"));
	expect(f.stored().profiles[0].pages[0].keys[0]?.config.title.text).toBe(
		"Draft title",
	);
});

for (const tag of [
	"textarea",
	"select",
	"nested contenteditable",
	"input",
	"textbox",
] as const)
	it(`MGMT-249 preserves the selected key when ${tag} owns Delete`, async () => {
		const f = await fixture();
		await f.select();
		const before = f.stored();
		const field = document.createElement(
			tag === "nested contenteditable" || tag === "textbox" ? "div" : tag,
		);
		if (tag === "nested contenteditable")
			field.setAttribute("contenteditable", "true");
		if (tag === "textbox") field.setAttribute("role", "textbox");
		const target =
			tag === "nested contenteditable"
				? field.appendChild(document.createElement("span"))
				: field;
		f.host.append(field);
		field.focus();
		await act(async () =>
			target.dispatchEvent(
				new KeyboardEvent("keyup", { key: "Delete", bubbles: true }),
			),
		);
		expect(f.calls.filter((c) => c.type === "delete")).toEqual([]);
		expect(f.stored()).toEqual(before);
		field.remove();
	});

for (const locked of [false, true])
	it(`MGMT-249 outside-field Delete ignores ordinary saved lock=${locked}`, async () => {
		const f = await fixture({ locked });
		await f.select();
		await act(async () =>
			window.dispatchEvent(new KeyboardEvent("keyup", { key: "Delete" })),
		);
		expect(f.calls.filter((c) => c.type === "delete")).toHaveLength(1);
		expect(f.stored().profiles[0].pages[0].keys[0]?.config.type).toBe("");
	});

it("MGMT-049 / MGMT-097 refreshes active profile names on external publications without saving translated labels", async () => {
	const f = await fixture();
	await f.publish({
		...f.stored(),
		profiles: EffectArray.map(f.stored().profiles, (p) => ({
			...p,
			name: p.id === "p" ? "External rename" : p.name,
		})),
	});
	expect(
		query(f.host, "#keys-profile", HTMLSelectElement).selectedOptions[0]
			?.textContent,
	).toBe("External rename");
	await input(query(f.host, "#keys-language", HTMLSelectElement), "de");
	expect(f.calls.filter((c) => c.type === "read").at(-1)).toEqual({
		type: "read",
		locale: "de",
	});
	expect(f.stored().profiles[0].name).toBe("Custom");
});

it("MGMT-096 follows selected-device publications to a subfolder and discards the unsaved key", async () => {
	const f = await fixture();
	await f.select();
	await input(query(f.host, "#key-title", HTMLInputElement), "Unsaved");
	await f.runtime.runPromise(
		ProfileService.selectProfile({
			deviceId: "other-device",
			profileId: "other",
			pageId: "subfolder",
		}),
	);
	await f.publish(f.stored());
	expect(query(f.host, "#keys-profile", HTMLSelectElement).value).toBe("p");
	await f.runtime.runPromise(
		ProfileService.selectProfile({
			deviceId: "desktop-preview",
			profileId: "other",
			pageId: "subfolder",
		}),
	);
	await f.publish(f.stored());
	expect(query(f.host, "#keys-profile", HTMLSelectElement).value).toBe("other");
	expect(query(f.host, "#keys-page", HTMLSelectElement).value).toBe(
		"subfolder",
	);
	expect(f.host.querySelector("#key-title")).toBeNull();
	expect(f.calls.some((c) => c.type === "revert")).toBe(true);
	expect(f.stored().profiles[0].pages[0].keys[0]?.config.title.text).toBe(
		"Sequence",
	);
});

it("MGMT-096 follows the strip fallback when a new device has no saved selection", async () => {
	const f = await fixture();
	await f.runtime.runPromise(
		ProfileService.selectProfile({
			deviceId: "desktop-preview",
			profileId: "other",
			pageId: "subfolder",
		}),
	);
	await f.publish(f.stored());
	expect(query(f.host, "#keys-profile", HTMLSelectElement).value).toBe("other");
	await f.device("new-device");
	const expected = selectStripPage(
		Schema.decodeUnknownSync(ProfileEnvelope)(f.stored()),
		"new-device",
	);
	expect(query(f.host, "#keys-profile", HTMLSelectElement).value).toBe(
		expected.profile.id,
	);
	expect(query(f.host, "#keys-page", HTMLSelectElement).value).toBe(
		expected.page.id,
	);
	await f.select();
	await input(
		query(f.host, "#key-title", HTMLInputElement),
		"Unsaved device draft",
	);
	await f.device("another-new-device");
	expect(f.host.querySelector("#key-title")).toBeNull();
	expect(f.calls.filter((c) => c.type === "revert")).toHaveLength(1);
	await f.device("desktop-preview");
	expect(query(f.host, "#keys-profile", HTMLSelectElement).value).toBe("other");
	expect(query(f.host, "#keys-page", HTMLSelectElement).value).toBe(
		"subfolder",
	);
	await f.publish({ ...f.stored(), activeByDevice: {} });
	expect(query(f.host, "#keys-profile", HTMLSelectElement).value).toBe("p");
	expect(query(f.host, "#keys-page", HTMLSelectElement).value).toBe("one");
});

for (const [profileId, type] of [
	["1-5", "aiChatView"],
	["1-8", "quakeBot"],
	["1-1", "liveAudioTranslateDisplay"],
] as const)
	it(`AI-145 / MGMT-357 ${type} gives nested controls touch ownership without host press feedback`, async () => {
		const p = builtinProfiles("win32").find((p) => p.id === profileId);
		if (!p) throw new Error("Missing built-in profile");
		const layout = stripLayout(p, p.pages[0]);
		const tile = layout.tiles.find((t) => t.type === type);
		if (!tile) throw new Error("Missing panel tile");
		expect(tile).toMatchObject({
			supportTouchEffect: false,
			hasTouchableSubElements: true,
			pressFeedback: false,
		});
		const view = {
			...previewVoiceContext.view,
			copilot: { ...previewVoiceContext.view.copilot, text: "Saved answer" },
		};
		const request = vi.fn<StripVoiceContext["request"]>(async () => ({
			_tag: "ok",
		}));
		const meeting = vi.fn<MeetingsBridge["request"]>(async () => ({
			_tag: "failure",
			code: "QUAKE.MEETING.UNAVAILABLE",
			message: "Synthetic meeting boundary",
		}));
		vi.stubGlobal("quakeMeetings", {
			request: meeting,
			onSnapshot: () => () => {},
		});
		const m = await mount(
			<StripScreen
				profiles={{
					_tag: "ready",
					envelope: {
						schemaVersion: 1,
						profiles: [p],
						activeByDevice: {},
						manager: Option.none(),
					},
				}}
				showEmptyGridDashedBorder={false}
				pressedKeyCode={tile.keyCode}
				voice={{
					...previewVoiceContext,
					view,
					surface: "panel",
					motion: "reduce",
					request,
				}}
			/>,
		);
		cleanups.push(m.close);
		const host = query(
			m.host,
			`[data-key-code="${tile.keyCode}"]`,
			HTMLDivElement,
		);
		expect(host.hasAttribute("data-pressed")).toBe(false);
		const childName =
			type === "aiChatView"
				? "copyAIChatContentIcon"
				: type === "quakeBot"
					? "quakeBotHeaderTouchIcon"
					: "meeting-tab-live";
		const child = host.querySelector<HTMLElement>(
			`[data-quake-sub-touch="${childName}"]`,
		);
		if (!child) throw new Error("Missing nested touch consumer");
		let received = 0;
		child.addEventListener("quake-sub-touch-end", () => {
			received++;
		});
		// happy-dom has no layout engine. Only DOM rectangles are supplied here;
		// production mountStripTouch owns coordinate conversion, hit mapping and dispatch.
		const rootRect = new DOMRect(80, 35, 960, 240);
		vi.spyOn(m.host, "getBoundingClientRect").mockReturnValue(rootRect);
		const children = Array.from(
			host.querySelectorAll<HTMLElement>("[data-quake-sub-touch]"),
		);
		const sibling = children.find((element) => element !== child);
		if (!sibling) throw new Error("Missing second nested touch consumer");
		const y = tile.slot.y + tile.slot.height / 2;
		const x = tile.slot.x + tile.slot.width / 4;
		const siblingX = tile.slot.x + (tile.slot.width * 3) / 4;
		for (const element of children) {
			const centerX =
				element === child ? x : element === sibling ? siblingX : -1000;
			vi.spyOn(element, "getBoundingClientRect").mockReturnValue(
				new DOMRect(
					rootRect.x + (centerX - 24) / 2,
					rootRect.y + (y - 24) / 2,
					24,
					24,
				),
			);
		}
		let siblingReceived = 0;
		sibling.addEventListener("quake-sub-touch-end", () => {
			siblingReceived++;
		});
		const keys: unknown[] = [];
		let publishTouch: ((event: QuakeEvent) => void) | undefined;
		const unmountTouch = mountStripTouch(
			m.host,
			{
				version: "test",
				onQuakeEvent: (callback) => {
					publishTouch = callback;
					return () => {
						publishTouch = undefined;
					};
				},
			},
			0,
			() => layout,
			(value) => keys.push(value),
		);
		cleanups.push(async () => unmountTouch());
		const tap = async (logicalX: number, logicalY: number) => {
			for (const action of [1, 0])
				await act(async () =>
					publishTouch?.({
						kind: "touch",
						source: "mock",
						points: [{ x: logicalX, y: 480 - logicalY, action }],
					}),
				);
		};
		await tap(
			tile.slot.x + tile.slot.width / 2,
			tile.slot.y + tile.slot.height - 10,
		);
		expect(received).toBe(0);
		expect(siblingReceived).toBe(0);
		await tap(x, y);
		expect(siblingReceived).toBe(0);
		expect(keys).toEqual([]);
		expect(received).toBe(1);
		if (type === "aiChatView")
			expect(request).toHaveBeenCalledWith({
				_tag: "CopyText",
				text: "Saved answer",
			});
		if (type === "quakeBot")
			expect(request).toHaveBeenCalledWith({
				_tag: "ReadAloud",
				keyCode: tile.keyCode,
				settings: readerSettings(tile.key.config.actions),
			});
		if (type === "liveAudioTranslateDisplay")
			expect(meeting).toHaveBeenCalledWith({ _tag: "tab", tab: "live" });
		await tap(siblingX, y);
		expect(received).toBe(1);
		expect(siblingReceived).toBe(1);
		expect(keys).toEqual([]);
	});

it("MGMT-097 updates built-in locale and external configuration without persisting injected labels", async () => {
	const f = await fixture();
	const quick = builtinProfiles("win32").find((p) => p.id === "1-2");
	if (!quick) throw new Error("Missing Quick");
	await f.runtime.runPromise(
		Effect.gen(function* () {
			const repository = yield* ProfileRepository;
			yield* repository.transact((envelope) =>
				Effect.succeed({
					...envelope,
					profiles: [...envelope.profiles, quick],
					activeByDevice: {
						"desktop-preview": { profileId: quick.id, pageId: "1" },
					},
				}),
			);
		}),
	);
	await f.publish(f.stored());
	await input(query(f.host, "#keys-language", HTMLSelectElement), "de");
	await settle(() =>
		expect(
			query(f.host, "#keys-profile", HTMLSelectElement).selectedOptions[0]
				?.textContent,
		).toBe(profileLabel(quick, "de")),
	);
	expect(f.stored().profiles.find((p) => p.id === quick.id)?.name).toBe(
		"Quick",
	);
	expect(
		f
			.stored()
			.profiles.find((p) => p.id === quick.id)
			?.pages[0].keys.find((k) => k.keyCode === "1,5")?.config.title.text,
	).toBe("Help");
	const prior = f.stored().profiles.find((p) => p.id === quick.id);
	if (!prior) throw new Error("Missing saved profile");
	await f.runtime.runPromise(
		Effect.gen(function* () {
			const repository = yield* ProfileRepository;
			yield* repository.transact((envelope) =>
				Effect.succeed({
					...envelope,
					profiles: EffectArray.map(envelope.profiles, (profile) =>
						profile.id === quick.id
							? {
									...profile,
									revision: profile.revision + 1,
									pages: EffectArray.map(profile.pages, (page) => ({
										...page,
										keys: page.keys.map((key) =>
											key.keyCode === "1,5"
												? {
														...key,
														config: {
															...key.config,
															title: {
																...key.config.title,
																text: "Changed externally",
															},
															userModifiedTitle: true,
														},
													}
												: key,
										),
									})),
								}
							: profile,
					),
				}),
			);
		}),
	);
	await f.publish(f.stored());
	expect(f.host.textContent).toContain("Changed externally");
});

it("MGMT-096 repeated publications preserve an unchanged draft and a pending Save", async () => {
	const f = await fixture();
	await f.select();
	await input(query(f.host, "#key-title", HTMLInputElement), "Kept draft");
	for (let index = 0; index < 3; index++) await f.publish(f.stored());
	expect(query(f.host, "#key-title", HTMLInputElement).value).toBe(
		"Kept draft",
	);
	expect(f.calls.filter((c) => c.type === "revert")).toHaveLength(0);
	const release = f.pauseWrite();
	await click(button(f.host, "Save"));
	await settle(() =>
		expect(
			query(f.host, ".keys-save-boundary", HTMLFieldSetElement).disabled,
		).toBe(true),
	);
	await f.publish(f.stored());
	expect(query(f.host, "#key-title", HTMLInputElement).value).toBe(
		"Kept draft",
	);
	await act(async () => release());
	await settle(() =>
		expect(
			query(f.host, ".keys-save-boundary", HTMLFieldSetElement).disabled,
		).toBe(false),
	);
	expect(f.stored().profiles[0].pages[0].keys[0]?.config.title.text).toBe(
		"Kept draft",
	);
	expect(f.calls.filter((c) => c.type === "save")).toHaveLength(1);
});

it("AI-041/054/060/062 MGMT-285 saves and reopens assistant controls through KeyEditor and KeyEditing", async () => {
	const f = await fixture({
		configure: (envelope) =>
			Schema.encodeSync(ProfileEnvelope)(
				Schema.decodeUnknownSync(ProfileEnvelope)({
					...envelope,
					profiles: envelope.profiles.map((p) =>
						p.id === "p"
							? {
									...p,
									pages: p.pages.map((page) => ({
										...page,
										keys: page.keys.map((key) => ({
											...key,
											childrenName: "aiChat",
											config: { ...key.config, type: "aiChat", actions: [] },
										})),
									})),
								}
							: p,
					),
				}),
			),
	});
	await f.select();
	await click(button(f.host, "Configure assistant"));
	const labelField = (label: string) => {
		const id = Array.from(f.host.querySelectorAll("label")).find(
			(l) => l.textContent === label,
		)?.htmlFor;
		return query(f.host, `[id="${id}"]`, HTMLInputElement);
	};
	await click(labelField("Custom role"));
	await input(
		query(f.host, "textarea", HTMLTextAreaElement),
		"Retained system prompt",
	);
	await input(labelField("Chat timeout in seconds"), "20");
	await click(labelField("Use agent"));
	await click(button(f.host, "Save"));
	await settle(() =>
		expect(f.host.textContent).toContain("Saved successfully"),
	);
	const saved = f.stored().profiles[0].pages[0].keys[0];
	expect(saved?.config.assistantSettings).toMatchObject({
		roleId: -1,
		customPrompt: "Retained system prompt",
		contextTimeoutSeconds: 20,
		useAgent: false,
	});
	if (!saved) throw new Error("saved assistant missing");
	expect(
		profileKeyFunctionIssues(
			Schema.decodeUnknownSync(ProfileKey)(saved),
			managementProfileContracts,
		),
	).toEqual([]);
	await click(button(f.host, "1,1"));
	await f.select();
	expect(query(f.host, "textarea", HTMLTextAreaElement).value).toBe(
		"Retained system prompt",
	);
	expect(labelField("Chat timeout in seconds").value).toBe("20");
});

it("MGMT-055 SETTINGS-013 shares the saved border preference with the actual key editor", async () => {
	const storageKey = "open-quake.strip.v1";
	localStorage.setItem(
		storageKey,
		JSON.stringify({ version: 1, showEmptyGridDashedBorder: false }),
	);
	const f = await fixture();
	const screen = query(f.host, ".keys-preview .strip-screen", HTMLDivElement);
	expect(screen.dataset.dashed).toBe("false");
	for (const show of [true, false]) {
		await act(async () =>
			window.dispatchEvent(
				new StorageEvent("storage", {
					key: storageKey,
					newValue: JSON.stringify({
						version: 1,
						showEmptyGridDashedBorder: show,
					}),
				}),
			),
		);
		expect(screen.dataset.dashed).toBe(String(show));
	}
});

it("MGMT-058 uses the painted mirror bounds and suppresses disabled press feedback", async () => {
	const f = await fixture();
	const preview = query(f.host, ".keys-preview", HTMLFieldSetElement);
	const screen = query(preview, ".strip-screen", HTMLDivElement);
	// Painted canvas can be inset by the border or by letterboxing.
	vi.spyOn(preview, "getBoundingClientRect").mockReturnValue(
		new DOMRect(0, 0, 1000, 500),
	);
	vi.spyOn(screen, "getBoundingClientRect").mockReturnValue(
		new DOMRect(20, 130, 960, 240),
	);
	const down = async () =>
		act(async () =>
			preview.dispatchEvent(
				new PointerEvent("pointerdown", {
					bubbles: true,
					clientX: 70,
					clientY: 180,
				}),
			),
		);
	await down();
	expect(
		preview
			.querySelector('[data-key-code="1,1"]')
			?.getAttribute("data-pressed"),
	).toBe("true");
	await act(async () =>
		preview.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })),
	);
	expect(preview.querySelector('[data-pressed="true"]')).toBeNull();
	await f.select();
	const release = f.pauseWrite();
	try {
		await click(button(f.host, "Save"));
		await settle(() =>
			expect(
				f.host.querySelector(".key-editor")?.getAttribute("aria-busy"),
			).toBe("true"),
		);
		await down();
		expect(preview.querySelector('[data-pressed="true"]')).toBeNull();
	} finally {
		release();
	}
	await settle(() =>
		expect(f.host.textContent).toContain("Saved successfully"),
	);
});

it("MGMT-280 count/add-step focus and Back preserve the real key draft", async () => {
	const f = await fixture();
	await f.select();
	expect(f.host.textContent).toContain("Contain: 3 Project");
	await click(button(f.host, "Add Operation"));
	expect(f.host.textContent).toContain("Contain: 4 Project");
	expect(document.activeElement).toBe(
		f.host.querySelector(".key-sequence-step:last-of-type select"),
	);
	await click(button(f.host, "Back"));
	expect(
		f.host.querySelector(".key-sequence > div")?.hasAttribute("hidden"),
	).toBe(true);
	await click(button(f.host, "Edit operations"));
	expect(f.host.querySelectorAll(".key-sequence-step")).toHaveLength(4);
	await click(button(f.host, "Save"));
	expect(
		f.stored().profiles[0].pages[0].keys[0]?.config.subActions,
	).toHaveLength(4);
});

it("MGMT-302 mounted local agent/model/voice/task Save retains typed actions and reset uses the isolated context command", async () => {
	const f = await fixture({ agentKey: true });
	await f.select();
	await input(query(f.host, "#key-local-agent", HTMLSelectElement), "writer");
	await input(
		query(f.host, "#key-local-agent-model", HTMLSelectElement),
		"fake-model",
	);
	await click(query(f.host, "#agent-key-voice", HTMLInputElement));
	await input(
		query(f.host, "#agent-key-task", HTMLTextAreaElement),
		"Prepare a local report",
	);
	const reset = vi.fn(async () => ({ _tag: "ok" }));
	vi.stubGlobal("quakeVoice", { request: reset });
	await click(button(f.host, "Reset Context"));
	expect(reset).toHaveBeenCalledWith({ _tag: "ResetContext", keyCode: "1,1" });
	expect(f.host.textContent).toContain("Context reset");
	await click(button(f.host, "Save"));
	expect(f.stored().profiles[0].pages[0].keys[0]?.config.actions).toEqual(
		expect.arrayContaining([
			{ type: "agentId", value: "writer" },
			{ type: "model", value: "fake-model" },
			{ type: "voiceInput", value: false },
			{ type: "taskPrompt", value: "Prepare a local report" },
		]),
	);
	await click(button(f.host, "Gateway settings"));
	expect(query(f.host, "input[type=password]", HTMLInputElement).value).toBe(
		"",
	);
	expect(
		f
			.stored()
			.profiles[0].pages[0].keys[0]?.config.actions?.some((a) =>
				/token|credential/i.test(a.type),
			),
	).toBe(false);
});

it("MGMT-302 absent voiceInput stays typed-only through mounted editing and save", async () => {
	const f = await fixture({
		agentKey: true,
		configure: (value) =>
			Schema.encodeSync(ProfileEnvelope)(
				Schema.decodeUnknownSync(ProfileEnvelope)({
					...value,
					profiles: value.profiles.map((profile) => ({
						...profile,
						pages: profile.pages.map((page) => ({
							...page,
							keys: page.keys.map((key) => ({
								...key,
								config: {
									...key.config,
									actions: (key.config.actions ?? []).filter(
										(a) => a.type !== "voiceInput",
									),
								},
							})),
						})),
					})),
				}),
			),
	});
	await f.select();
	expect(query(f.host, "#agent-key-voice", HTMLInputElement).checked).toBe(
		false,
	);
	await input(
		query(f.host, "#agent-key-task", HTMLTextAreaElement),
		"Typed task",
	);
	await click(button(f.host, "Save"));
	const actions = f.stored().profiles[0].pages[0].keys[0]?.config.actions;
	expect(actions).toContainEqual({ type: "taskPrompt", value: "Typed task" });
	expect(actions?.some((a) => a.type === "voiceInput")).toBe(false);
	await click(query(f.host, "#agent-key-voice", HTMLInputElement));
	expect(f.host.querySelector("#agent-key-task")).toBeNull();
	await click(button(f.host, "Save"));
	expect(
		f.stored().profiles[0].pages[0].keys[0]?.config.actions,
	).toContainEqual({ type: "voiceInput", value: true });
});

it("MGMT-306 saves/reopens DK Claw agent and model through the mounted knob consumer and canonical profile storage", async () => {
	const f = await fixture({ knobKey: true });
	expect(
		f.host
			.querySelector(".knob-editor")
			?.closest(".group")
			?.querySelector(".group-description")?.textContent,
	).toBe("Idle rotation selects profiles.");
	await input(query(f.host, "#knob-function", HTMLSelectElement), "assistant");
	await input(query(f.host, "#knob-route", HTMLSelectElement), "dkclaw");
	await input(query(f.host, "#knob-local-agent", HTMLSelectElement), "writer");
	await input(
		query(f.host, "#knob-local-agent-model", HTMLSelectElement),
		"fake-model",
	);
	await click(button(f.host, "Save knob"));
	expect(f.host.textContent).toContain("Knob voice settings saved");
	const saved = await f.runtime.runPromise(ProfileService.getProfile("p"));
	expect(
		Option.isSome(saved.knob) && saved.knob.value.config.subActions,
	).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				config: expect.objectContaining({
					actions: expect.arrayContaining([
						{ type: "voiceRoute", value: "dkclaw" },
						{ type: "agentId", value: "writer" },
						{ type: "dkclawModel", value: "fake-model" },
					]),
				}),
			}),
		]),
	);
	await click(button(f.host, "Cancel"));
	expect(query(f.host, "#knob-local-agent", HTMLSelectElement).value).toBe(
		"writer",
	);
	await input(query(f.host, "#knob-local-agent", HTMLSelectElement), "main");
	await input(query(f.host, "#knob-local-agent-model", HTMLSelectElement), "");
	await click(button(f.host, "Save knob"));
	const reset = await f.runtime.runPromise(ProfileService.getProfile("p"));
	expect(
		Option.isSome(reset.knob) && reset.knob.value.config.subActions,
	).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				config: expect.objectContaining({
					actions: [
						{ type: "voiceRoute", value: "dkclaw" },
						{ type: "agentId", value: "main" },
					],
				}),
			}),
		]),
	);
});

function gridKey(
	code: string,
	type = "hotkey",
	config: Record<string, unknown> = {},
): typeof ProfileKey.Encoded {
	const empty = Schema.encodeSync(ProfileKey)(createEmptyProfileKey(code));
	return Schema.encodeSync(ProfileKey)(
		Schema.decodeUnknownSync(ProfileKey)({
			...empty,
			childrenName: type,
			config: {
				...empty.config,
				type,
				title: { ...empty.config.title, text: `${type} ${code}` },
				actions: type === "hotkey" ? [{ type: "key", value: "a" }] : [],
				...config,
			},
		}),
	);
}
async function gridFixture(
	keys: readonly (typeof ProfileKey.Encoded)[],
	extraPages: readonly {
		id: string;
		keys: readonly (typeof ProfileKey.Encoded)[];
	}[] = [],
) {
	return fixture({
		configure: (value) => ({
			...value,
			profiles: [
				{ ...value.profiles[0], pages: [{ id: "one", keys }, ...extraPages] },
				...value.profiles.slice(1),
			],
		}),
	});
}
async function keyEvent(element: Element, key: string) {
	await act(async () =>
		element.dispatchEvent(
			new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
		),
	);
}
async function libraryPlace(host: HTMLElement, type: string, code: string) {
	await click(query(host, `[data-library-type="${type}"]`, HTMLButtonElement));
	await keyEvent(button(host, code), "Enter");
}
async function pointerMove(
	host: HTMLElement,
	source: HTMLElement,
	code: string,
) {
	await act(async () =>
		source.dispatchEvent(
			new PointerEvent("pointerdown", {
				bubbles: true,
				button: 0,
				clientX: 5,
				clientY: 5,
			}),
		),
	);
	const target = button(host, code);
	await act(async () =>
		target.dispatchEvent(
			new PointerEvent("pointermove", {
				bubbles: true,
				clientX: 50,
				clientY: 50,
			}),
		),
	);
	await act(async () =>
		target.dispatchEvent(
			new PointerEvent("pointerup", {
				bubbles: true,
				clientX: 50,
				clientY: 50,
			}),
		),
	);
}

it("MGMT-057/064/066 SCREEN-138 selects the covered anchor, visibly deselects and rolls back its preview", async () => {
	const f = await gridFixture([gridKey("1,8", "hotkey", { size: [2, 1] })]);
	await click(button(f.host, "1,7"));
	expect(query(f.host, "#key-title", HTMLInputElement).value).toBe(
		"hotkey 1,8",
	);
	expect(button(f.host, "1,8").getAttribute("aria-pressed")).toBe("true");
	await input(query(f.host, "#key-title", HTMLInputElement), "Unsaved");
	await click(button(f.host, "1,7"));
	expect(f.host.querySelector("#key-title")).toBeNull();
	expect(f.host.querySelector('[data-selected="true"]')).toBeNull();
	expect(f.stored().profiles[0].pages[0].keys[0]?.config.title.text).toBe(
		"hotkey 1,8",
	);
	expect(f.calls.filter((c) => c.type === "save")).toHaveLength(0);
});

it("MGMT-066/067 SCREEN-138/143 localizes empty/default guidance beside resizable meeting tiles", async () => {
	const f = await gridFixture([
		gridKey("1,1", "liveAudioTranslateDisplay", { size: [5, 2] }),
	]);
	await click(button(f.host, "1,7"));
	await click(button(f.host, "1,7"));
	expect(f.host.querySelector("#key-title")).toBeNull();
	expect(f.host.textContent).toContain(
		"Drag an action from the sidebar and place it in the empty key above",
	);
	await input(query(f.host, "#keys-language", HTMLSelectElement), "de");
	expect(f.host.textContent).toContain("Ziehen Sie eine Aktion");
	await f.publish({
		...f.stored(),
		profiles: [
			{ ...f.stored().profiles[0], compatibility: { builtin: "default" } },
		],
	});
	expect(f.host.textContent).toContain(
		"Standardkonfigurationen können nicht gelöscht",
	);
});

it("MGMT-066/078 retargets the open picker across keys and discards replies after profile changes", async () => {
	const f = await gridFixture([gridKey("1,1"), gridKey("1,2")]);
	const original = window.quakeKeyLibrary.request;
	const openings: { token: string; resolve: (reply: KeyReply) => void }[] = [];
	const request = vi
		.spyOn(window.quakeKeyLibrary, "request")
		.mockImplementation((command) => {
			if (command.type === "open-icons")
				return new Promise<KeyReply>((resolve) => {
					openings.push({ token: command.token, resolve });
				});
			return original(command);
		});
	await f.select();
	await click(button(f.host, "Icon library"));
	expect(openings).toHaveLength(1);
	await click(button(f.host, "1,2"));
	await settle(() => expect(openings).toHaveLength(2));
	expect(openings[0]?.token).not.toBe(openings[1]?.token);
	await act(async () =>
		openings[0]?.resolve({ _tag: "success", icon: "obsolete-one" }),
	);
	expect(query(f.host, "#key-title", HTMLInputElement).value).toBe(
		"hotkey 1,2",
	);
	await input(query(f.host, "#keys-profile", HTMLSelectElement), "other");
	await act(async () =>
		openings[1]?.resolve({ _tag: "success", icon: "obsolete-two" }),
	);
	expect(f.host.querySelector("#key-title")).toBeNull();
	expect(
		f.calls.filter(
			(command) =>
				command.type === "preview" &&
				command.key.config.icon.startsWith("obsolete"),
		),
	).toHaveLength(0);
	expect(
		f.calls.filter((command) => command.type === "cancel-icons"),
	).toHaveLength(2);
	request.mockRestore();
});

it.each([false, true])(
	"opens the icon library and applies artwork with a saved icon lock=%s",
	async (locked) => {
		const quick = builtinProfiles("darwin", "en").find(
			(profile) => profile.id === "1-2",
		);
		const builtinKey = quick?.pages[0].keys.find(
			(key) => key.config.type === "mic",
		);
		if (!builtinKey) throw new Error("Missing built-in Quick microphone key");
		const key = Schema.encodeSync(ProfileKey)(builtinKey);
		const f = await gridFixture([
			{
				...key,
				keyCode: "1,1",
				config: {
					...key.config,
					basicEditableItems: {
						...key.config.basicEditableItems,
						icon: !locked,
					},
				},
			},
		]);
		const original = window.quakeKeyLibrary.request;
		let finish = (_reply: KeyReply) => {};
		let openWindow = () => {};
		function PickerHost() {
			const [open, setOpen] = useState(false);
			openWindow = () => setOpen(true);
			return open ? <IconPickerSurface /> : null;
		}
		const chooser = await mount(<PickerHost />);
		cleanups.push(chooser.close);
		vi.spyOn(window.quakeKeyLibrary, "request").mockImplementation(
			(command) => {
				if (command.type === "open-icons") {
					// Simulate loading the child renderer only when its bridge is invoked.
					openWindow();
					return new Promise<KeyReply>((resolve) => {
						finish = resolve;
					});
				}
				if (command.type === "icons" || command.type === "application-icons")
					return Promise.resolve({ _tag: "success", packs: [] });
				return original(command);
			},
		);
		await f.select();
		const before = f.stored();
		await click(button(f.host, "Icon library"));
		await settle(() =>
			expect(
				chooser.host.querySelector('[aria-label="Icon library"]'),
			).toBeDefined(),
		);
		expect(
			chooser.host.querySelector('[aria-label="Icon library"]'),
		).not.toBeNull();
		const icon = "data:image/png;base64,AAAA";
		await act(async () => finish({ _tag: "success", icon }));
		expect(f.stored()).toEqual(before);
		// Saved icon locks no longer apply: every key's artwork is editable.
		const previews = f.calls.filter((command) => command.type === "preview");
		expect(previews).toHaveLength(1);
		expect(previews[0]?.key.config.icon).toBe(icon);
	},
);

it("MGMT-066/078 SCREEN-138 click-away reverts an unsaved preview without writing", async () => {
	const f = await gridFixture([gridKey("1,1")]);
	await f.select();
	await input(query(f.host, "#key-title", HTMLInputElement), "Unsaved");
	await act(async () =>
		document.body.dispatchEvent(
			new PointerEvent("pointerdown", { bubbles: true }),
		),
	);
	await settle(() => expect(f.host.querySelector("#key-title")).toBeNull());
	expect(f.stored().profiles[0].pages[0].keys[0]?.config.title.text).toBe(
		"hotkey 1,1",
	);
	expect(f.writes()).toBe(0);
});

it("MGMT-068/069/076/078 SCREEN-136 pointer placement reverts drafts, isolates defaults and autosaves exactly once", async () => {
	const f = await gridFixture([gridKey("1,1")]);
	await f.select();
	await input(query(f.host, "#key-title", HTMLInputElement), "Unsaved");
	await pointerMove(
		f.host,
		query(f.host, '[data-library-type="timer"]', HTMLButtonElement),
		"2,8",
	);
	await settle(() => expect(f.stored().profiles[0].revision).toBe(1));
	const keys = f.stored().profiles[0].pages[0].keys;
	expect(keys.find((k) => k.keyCode === "1,1")?.config.title.text).toBe(
		"hotkey 1,1",
	);
	expect(keys.find((k) => k.keyCode === "2,8")?.config).toMatchObject({
		type: "timer",
		compatibility: {
			defaultIcon: expect.stringContaining("data:image/svg+xml"),
		},
	});
	expect(button(f.host, "2,8").getAttribute("aria-pressed")).toBe("true");
	expect(f.calls.filter((c) => c.type === "save")).toHaveLength(1);
	expect(f.writes()).toBe(1);
	await libraryPlace(f.host, "timer", "2,7");
	await settle(() => expect(f.stored().profiles[0].revision).toBe(2));
	expect(
		f
			.stored()
			.profiles[0].pages[0].keys.filter((k) => k.config.type === "timer"),
	).toHaveLength(2);
});

it("MGMT-068/078 cancels outside-grid pointer placement and Escape without saving or using stale coordinates", async () => {
	const f = await gridFixture([]);
	const source = query(
		f.host,
		'[data-library-type="timer"]',
		HTMLButtonElement,
	);
	await act(async () =>
		source.dispatchEvent(
			new PointerEvent("pointerdown", {
				bubbles: true,
				button: 0,
				clientX: 0,
				clientY: 0,
			}),
		),
	);
	await act(async () =>
		document.body.dispatchEvent(
			new PointerEvent("pointermove", {
				bubbles: true,
				clientX: 50,
				clientY: 50,
			}),
		),
	);
	await act(async () =>
		document.body.dispatchEvent(
			new PointerEvent("pointerup", {
				bubbles: true,
				clientX: 50,
				clientY: 50,
			}),
		),
	);
	await click(source);
	await keyEvent(button(f.host, "1,1"), "Escape");
	await keyEvent(button(f.host, "2,8"), "Enter");
	expect(f.stored().profiles[0].pages[0].keys).toHaveLength(0);
	expect(f.calls.filter((c) => c.type === "save")).toHaveLength(0);
});

it("MGMT-070/075 SCREEN-136 requires replacement confirmation including anchor and clears complete footprints", async () => {
	const f = await gridFixture([
		gridKey("1,1", "hotkey", { size: [2, 1] }),
		gridKey("1,3"),
	]);
	const before = f.stored();
	await libraryPlace(f.host, "playAudio", "2,8");
	expect(f.host.querySelector('[role="alertdialog"]')?.textContent).toContain(
		"hotkey 1,1、hotkey 1,3",
	);
	expect(f.stored()).toEqual(before);
	await click(button(f.host, "Cancel"));
	expect(f.stored()).toEqual(before);
	await libraryPlace(f.host, "playAudio", "2,8");
	await click(button(f.host, "Confirm replacement"));
	await settle(() => expect(f.stored().profiles[0].revision).toBe(1));
	expect(f.stored().profiles[0].pages[0].keys).toEqual([
		expect.objectContaining({
			keyCode: "1,1",
			config: expect.objectContaining({ type: "playAudio", size: [8, 2] }),
		}),
	]);
	expect(f.calls.filter((c) => c.type === "save")).toHaveLength(1);
});

it("MGMT-070/076 coalesces repeated confirmation while reading the saved revision", async () => {
	const f = await gridFixture([gridKey("1,1")]);
	await libraryPlace(f.host, "timer", "1,1");
	const original = window.quakeKeyLibrary.request;
	let release = () => {};
	const paused = new Promise<void>((resolve) => {
		release = resolve;
	});
	const request = vi
		.spyOn(window.quakeKeyLibrary, "request")
		.mockImplementation(async (command) => {
			if (command.type === "read") await paused;
			return original(command);
		});
	const confirm = button(f.host, "Confirm replacement");
	await act(async () => {
		confirm.click();
		confirm.click();
	});
	expect(
		request.mock.calls.filter(([command]) => command.type === "read"),
	).toHaveLength(1);
	await act(async () => release());
	await settle(() => expect(f.stored().profiles[0].revision).toBe(1));
	expect(f.calls.filter((command) => command.type === "save")).toHaveLength(1);
	request.mockRestore();
});

it("MGMT-069/071 gives brightness, page numbers and alternate hotkeys detached default artwork", async () => {
	const f = await gridFixture([]);
	await libraryPlace(f.host, "brightness", "1,1");
	await settle(() => expect(f.stored().profiles[0].revision).toBe(1));
	await libraryPlace(f.host, "pageNo", "1,3");
	await settle(() => expect(f.stored().profiles[0].revision).toBe(2));
	await libraryPlace(f.host, "hotkeySwitch", "1,5");
	await settle(() => expect(f.stored().profiles[0].revision).toBe(3));
	const keys = f.stored().profiles[0].pages[0].keys;
	const brightness = keys.find(
		(key) => key.config.type === "brightness",
	)?.config;
	expect(decodeURIComponent(brightness?.icon ?? "")).toContain("svg");
	expect(brightness?.compatibility?.defaultIcon).toBe(brightness?.icon);
	const number = keys.find((key) => key.config.type === "pageNo")?.config;
	expect(decodeURIComponent(number?.icon ?? "")).toContain(">1</text>");
	expect(number?.compatibility).toMatchObject({
		pageNumber: 1,
		defaultIcon: number?.icon,
	});
	const alternate = keys.find(
		(key) => key.config.type === "hotkeySwitch",
	)?.config;
	expect(alternate?.alterIcon).toBe(alternate?.icon);
	expect(alternate?.compatibility?.defaultAlterIcon).toBe(alternate?.alterIcon);
});

for (const type of [
	"back",
	"emojiBack",
	"functionwheel",
	"colorfulScreenSettings",
	"colorfulScreen",
	"locked",
])
	it(`MGMT-070/074 SCREEN-136 refuses ${type} replacement without changing the profile`, async () => {
		const f = await gridFixture([
			gridKey(
				"1,1",
				type === "locked" ? "meetingRecordMark" : type,
				type === "locked" ? { basicEditableItems: { allowDelete: false } } : {},
			),
		]);
		const before = f.stored();
		await libraryPlace(f.host, "timer", "1,1");
		expect(f.stored()).toEqual(before);
		expect(f.calls.filter((c) => c.type === "save")).toHaveLength(0);
		expect(f.host.querySelector('[role="alertdialog"]')).toBeNull();
	});

it("MGMT-071/077 SCREEN-138 atomically allocates a folder with protected Back and enters/returns without host execution", async () => {
	const f = await gridFixture([]);
	await libraryPlace(f.host, "createFolder", "1,3");
	await settle(() => expect(f.stored().profiles[0].pages).toHaveLength(2));
	const folder = f.stored().profiles[0].pages[1];
	expect(folder?.keys[0]).toMatchObject({
		keyCode: "1,1",
		config: {
			type: "back",
			basicEditableItems: { allowDelete: false, allowDrag: false },
		},
	});
	await act(async () =>
		button(f.host, "1,3").dispatchEvent(
			new MouseEvent("dblclick", { bubbles: true }),
		),
	);
	await settle(() =>
		expect(query(f.host, "#keys-page", HTMLSelectElement).value).toBe(
			folder?.id,
		),
	);
	await act(async () =>
		button(f.host, "1,1").dispatchEvent(
			new MouseEvent("dblclick", { bubbles: true }),
		),
	);
	await settle(() =>
		expect(query(f.host, "#keys-page", HTMLSelectElement).value).toBe("one"),
	);
	expect(f.calls.filter((c) => c.type === "activate")).toHaveLength(0);
	expect(f.stored().profiles[0].revision).toBe(1);
});

it("MGMT-071/045/046 opens multi-action editing after drop and retains knob and responsive editor controls", async () => {
	const f = await gridFixture([]);
	await libraryPlace(f.host, "multiActions", "1,1");
	await settle(() => expect(f.stored().profiles[0].revision).toBe(1));
	expect(f.host.querySelector(".key-sequence")).not.toBeNull();
	expect(f.host.querySelector(".knob-editor")).not.toBeNull();
	expect(f.host.querySelector(".keys-library-items")).not.toBeNull();
	await act(async () => window.dispatchEvent(new Event("resize")));
	expect(f.host.querySelector("#key-function")).not.toBeNull();
});

for (const occupied of [false, true])
	for (const width of [1, 2])
		it(`Move / swap selector persists a ${occupied ? "swap" : "move"} of width ${width} and updates the panel preview`, async () => {
			const one = gridKey("1,1", "hotkey", { size: [width, 1] });
			const two = gridKey("2,8", "hotkey", {
				size: [width, 1],
				actions: [{ type: "key", value: "b" }],
			});
			const f = await gridFixture(occupied ? [one, two] : [one]);
			await click(button(f.host, "1,1"));
			const destination = occupied && width === 2 ? "2,7" : "2,8";
			await input(
				query(f.host, "#key-destination", HTMLSelectElement),
				destination,
			);
			expect(f.calls.at(-1)).toMatchObject({
				type: "preview",
				geometry: { destination },
			});
			expect(f.stored().profiles[0].revision).toBe(0);
			expect(
				f.host.querySelector('[data-key-code="2,8"] .strip-tile-title')
					?.textContent,
			).toBe(one.config.title.text);
			await click(button(f.host, "Save"));
			await settle(() => expect(f.stored().profiles[0].revision).toBe(1));
			expect(f.stored().profiles[0].pages[0].keys).toEqual(
				expect.arrayContaining([
					{ ...one, keyCode: "2,8" },
					...(occupied ? [{ ...two, keyCode: "1,1" }] : []),
				]),
			);
			expect(
				f.host.querySelector('[data-key-code="2,8"] .strip-tile-title')
					?.textContent,
			).toBe(one.config.title.text);
			expect(
				f.host.querySelector('[data-key-code="1,1"] .strip-tile-title')
					?.textContent ?? "",
			).toBe(occupied ? two.config.title.text : "");
			expect(button(f.host, "2,8").getAttribute("aria-pressed")).toBe("true");
			await input(query(f.host, "#key-title", HTMLInputElement), "Moved key");
			await click(button(f.host, "Save"));
			await settle(() => expect(f.stored().profiles[0].revision).toBe(2));
			expect(
				f
					.stored()
					.profiles[0].pages[0].keys.find((key) => key.keyCode === "2,8")
					?.config.title.text,
			).toBe("Moved key");
		});

it("the built-in Quick Luminance key is editable like any key despite its DK-Suite template lock", async () => {
	const quick = builtinProfiles("darwin").find((p) =>
		p.pages[0].keys.some((k) => k.config.type === "luminance"),
	);
	const key = quick?.pages[0].keys.find((k) => k.config.type === "luminance");
	if (!key) throw new Error("Missing Quick Luminance fixture");
	const f = await gridFixture([Schema.encodeSync(ProfileKey)(key)]);
	await click(button(f.host, key.keyCode));
	expect(query(f.host, "#key-title", HTMLInputElement).disabled).toBe(false);
	expect(f.host.querySelector("#key-title-locked")).toBeNull();
});

it("a saved title lock no longer disables rename or shows a lock note", async () => {
	const locked = gridKey("1,1", "hotkey");
	const f = await gridFixture([
		{
			...locked,
			config: {
				...locked.config,
				basicEditableItems: {
					title: false,
					icon: true,
					grid: true,
					allowDelete: true,
					allowDrag: true,
				},
			},
		},
	]);
	await click(button(f.host, "1,1"));
	const title = query(f.host, "#key-title", HTMLInputElement);
	expect(title.disabled).toBe(false);
	expect(f.host.querySelector("#key-title-locked")).toBeNull();
	await input(title, "Saved key renamed");
	await click(button(f.host, "Save"));
	await settle(() => expect(f.stored().profiles[0].revision).toBe(1));
	expect(f.stored().profiles[0].pages[0].keys[0]?.config.title.text).toBe(
		"Saved key renamed",
	);
});

it("editable Luminance titles save and render like other keys", async () => {
	const f = await gridFixture([gridKey("1,1", "luminance")]);
	await click(button(f.host, "1,1"));
	expect(query(f.host, "#key-title", HTMLInputElement).disabled).toBe(false);
	await input(query(f.host, "#key-title", HTMLInputElement), "Panel light");
	await click(button(f.host, "Save"));
	await settle(() => expect(f.stored().profiles[0].revision).toBe(1));
	expect(f.stored().profiles[0].pages[0].keys[0]?.config).toMatchObject({
		title: { text: "Panel light" },
		userModifiedTitle: true,
	});
	expect(
		f.host.querySelector('[data-key-code="1,1"] .strip-tile-title')
			?.textContent,
	).toBe("Panel light");
	await click(button(f.host, "1,1"));
	await click(button(f.host, "1,1"));
	expect(query(f.host, "#key-title", HTMLInputElement).value).toBe(
		"Panel light",
	);
});

it("MGMT-073/074/076 SCREEN-137 moves/swaps equal spans by coordinates only and resolves a covered destination anchor", async () => {
	const one = gridKey("1,1", "hotkey", { size: [2, 1] });
	const two = gridKey("2,8", "hotkey", {
		size: [2, 1],
		actions: [{ type: "key", value: "b" }],
	});
	const f = await gridFixture([one, two]);
	await click(button(f.host, "1,1"));
	await keyEvent(button(f.host, "1,1"), " ");
	await keyEvent(button(f.host, "2,7"), "Enter");
	await settle(() => expect(f.stored().profiles[0].revision).toBe(1));
	expect(f.stored().profiles[0].pages[0].keys).toEqual(
		expect.arrayContaining([
			{ ...one, keyCode: "2,8" },
			{ ...two, keyCode: "1,1" },
		]),
	);
	expect(button(f.host, "2,8").getAttribute("aria-pressed")).toBe("true");
	expect(f.calls.filter((c) => c.type === "save")).toHaveLength(1);
});

for (const destination of ["1,3", "2,4", "2,3"])
	it(`MGMT-074/075 SCREEN-137 shows forbidden feedback for mismatch, ghost or partial overlap at ${destination}`, async () => {
		const f = await gridFixture([
			gridKey("1,1"),
			gridKey("1,3", "hotkey", { size: [2, 2] }),
		]);
		const before = f.stored();
		await keyEvent(button(f.host, "1,1"), " ");
		await act(async () =>
			button(f.host, destination).dispatchEvent(
				new PointerEvent("pointerover", { bubbles: true }),
			),
		);
		expect(button(f.host, destination).dataset.drop).toBe("forbidden");
		expect(f.host.textContent).toContain(
			destination === "1,3"
				? "Shortcut size mismatch at target position"
				: "Insufficient space in target area",
		);
		await keyEvent(button(f.host, destination), "Enter");
		expect(f.stored()).toEqual(before);
	});

it("MGMT-061 labels four presets and custom size, applies inward edge geometry and locks forced spans", async () => {
	const f = await gridFixture([gridKey("1,8")]);
	await click(button(f.host, "1,8"));
	const size = query(f.host, "#key-span", HTMLSelectElement);
	expect([...size.options].map((o) => o.textContent)).toEqual(
		expect.arrayContaining([
			"1x1 single",
			"2x1 horizontal",
			"1x2 vertical",
			"2x2 four cells",
			"Custom 3x1",
		]),
	);
	await input(size, "2,1");
	await click(button(f.host, "Save"));
	await settle(() => expect(f.stored().profiles[0].revision).toBe(1));
	await libraryPlace(f.host, "playAudio", "1,1");
	await click(button(f.host, "Confirm replacement"));
	await settle(() =>
		expect(query(f.host, "#key-span", HTMLSelectElement).disabled).toBe(true),
	);
});

it("MGMT-111 SCREEN-139 lists every overflowing import item/span and preserves source and profiles on cancel", async () => {
	const f = await gridFixture([]);
	const records = Array.from({ length: 17 }, (_, i) =>
		gridKey(
			`${Math.floor(i / 8) + 1},${(i % 8) + 1}` === "3,1"
				? "1,1"
				: `${Math.floor(i / 8) + 1},${(i % 8) + 1}`,
			"hotkey",
			{ size: i === 0 ? [2, 1] : [1, 1] },
		),
	);
	const source = JSON.stringify(records);
	const before = f.stored();
	await input(query(f.host, "#keys-import-json", HTMLTextAreaElement), source);
	await click(button(f.host, "Inspect import"));
	const dialog = query(f.host, '[role="alertdialog"]', HTMLDivElement);
	expect(dialog.getAttribute("aria-label")).toBe("Layout overflow warning");
	expect(dialog.querySelectorAll("li")).toHaveLength(17);
	expect(dialog.textContent).toContain("2×1");
	await click(button(dialog, "Cancel"));
	expect(query(f.host, "#keys-import-json", HTMLTextAreaElement).value).toBe(
		source,
	);
	expect(f.stored()).toEqual(before);
	expect(button(f.host, "Import as new profile").disabled).toBe(true);
});

it("MGMT-073 SCREEN-137 pointer moves an existing key to an empty cell without touching configuration", async () => {
	const key = gridKey("1,1");
	const f = await gridFixture([key]);
	await pointerMove(f.host, button(f.host, "1,1"), "2,8");
	await settle(() => expect(f.stored().profiles[0].revision).toBe(1));
	expect(f.stored().profiles[0].pages[0].keys).toEqual([
		{ ...key, keyCode: "2,8" },
	]);
});

it("MGMT-076/078 rejects a stale drop and preserves the concurrent profile revision", async () => {
	const f = await gridFixture([gridKey("1,1")]);
	await click(query(f.host, '[data-library-type="timer"]', HTMLButtonElement));
	await f.runtime.runPromise(
		Effect.gen(function* () {
			const repository = yield* ProfileRepository;
			yield* repository.transact((value) =>
				Effect.succeed({
					...value,
					profiles: EffectArray.map(value.profiles, (p) =>
						p.id === "p"
							? { ...p, revision: p.revision + 1, name: "Concurrent" }
							: p,
					),
				}),
			);
		}),
	);
	await keyEvent(button(f.host, "2,8"), "Enter");
	expect(f.host.textContent).toContain("QUAKE.PROFILE.REVISION_CONFLICT");
	expect(f.stored().profiles[0]).toMatchObject({
		revision: 1,
		name: "Concurrent",
	});
	expect(f.stored().profiles[0].pages[0].keys).toHaveLength(1);
});

it("MGMT-069/076 failed placement write preserves the original profile and can retry", async () => {
	const f = await gridFixture([]);
	const before = f.stored();
	f.fail(true);
	await libraryPlace(f.host, "timer", "2,8");
	await settle(() =>
		expect(f.host.textContent).toContain("QUAKE.PROFILE.WRITE_FAILED"),
	);
	expect(f.stored()).toEqual(before);
	f.fail(false);
	await click(button(f.host, "Save"));
	await settle(() => expect(f.stored().profiles[0].revision).toBe(1));
});

it("MGMT-069 saves incomplete registry defaults as nonexecutable configuration and accepts a configured edit", async () => {
	const f = await gridFixture([]);
	await libraryPlace(f.host, "text", "1,1");
	await settle(() => expect(f.stored().profiles[0].revision).toBe(1));
	expect(f.stored().profiles[0].pages[0].keys[0]?.config.actions).toEqual([
		{ type: "text", value: "" },
	]);
	await input(query(f.host, "#key-action-0", HTMLInputElement), "Configured");
	await click(button(f.host, "Save"));
	await settle(() => expect(f.stored().profiles[0].revision).toBe(2));
	expect(f.calls.filter((c) => c.type === "activate")).toHaveLength(0);
});

it("MGMT-077 enters emoji folders, returns to the originating page and wraps editor pages without executing keys", async () => {
	const f = await gridFixture(
		[
			gridKey("1,1", "emojiFolder", {
				actions: [{ type: "emojiFolderId", value: "emoji-page" }],
			}),
			gridKey("1,2", "previousPage"),
		],
		[
			{
				id: "emoji-page",
				keys: [gridKey("1,1", "emojiBack"), gridKey("1,2", "nextPage")],
			},
		],
	);
	const double = async (code: string) => {
		await act(async () =>
			button(f.host, code).dispatchEvent(
				new MouseEvent("dblclick", { bubbles: true }),
			),
		);
	};
	await double("1,1");
	await settle(() =>
		expect(query(f.host, "#keys-page", HTMLSelectElement).value).toBe(
			"emoji-page",
		),
	);
	await double("1,1");
	await settle(() =>
		expect(query(f.host, "#keys-page", HTMLSelectElement).value).toBe("one"),
	);
	await double("1,2");
	await settle(() =>
		expect(query(f.host, "#keys-page", HTMLSelectElement).value).toBe(
			"emoji-page",
		),
	);
	await double("1,2");
	await settle(() =>
		expect(query(f.host, "#keys-page", HTMLSelectElement).value).toBe("one"),
	);
	expect(
		f.calls.filter((c) => c.type === "activate" || c.type === "save"),
	).toHaveLength(0);
});

it("remaps imported folder, emoji and page links before mounted editor navigation with colliding source IDs", async () => {
	const f = await gridFixture([]);
	const existing = structuredClone(f.stored().profiles);
	const source = {
		id: "p",
		name: "Imported folders",
		revision: 7,
		pages: [
			{
				id: "one",
				keys: [
					gridKey("1,1", "createFolder", {
						actions: [{ type: "folder", value: "subfolder" }],
					}),
					gridKey("1,2", "emojiFolder", {
						actions: [{ type: "emojiFolderId", value: "emoji-page" }],
					}),
					gridKey("1,3", "createFolder", {
						actions: [{ type: "page", value: "emoji-page" }],
					}),
					gridKey("1,4", "goToPage", { actions: [{ type: "page", value: 2 }] }),
				],
			},
			{
				id: "subfolder",
				keys: [
					gridKey("1,1", "back", {
						actions: [{ type: "parentFolder", value: "one" }],
					}),
				],
			},
			{
				id: "emoji-page",
				keys: [
					gridKey("1,1", "emojiBack", {
						actions: [{ type: "parentFolder", value: "one" }],
					}),
				],
			},
		],
	};
	await input(
		query(f.host, "#keys-import-json", HTMLTextAreaElement),
		JSON.stringify(source),
	);
	await click(button(f.host, "Inspect import"));
	await settle(() =>
		expect(
			query(f.host, "#keys-confirm-import", HTMLButtonElement).disabled,
		).toBe(false),
	);
	await click(button(f.host, "Import as new profile"));
	await settle(() =>
		expect(query(f.host, "#keys-profile", HTMLSelectElement).value).toBe(
			"imported",
		),
	);
	const imported = f.stored().profiles.find((p) => p.id === "imported");
	expect(imported?.pages.map((p) => p.id)).toEqual([
		"imported-page-1",
		"imported-page-2",
		"imported-page-3",
	]);
	expect(imported?.pages[0].keys).toHaveLength(16);
	expect(
		imported?.pages[0].keys
			.filter((k) => k.config.type !== "")
			.map((k) => k.config.actions?.[0]?.value),
	).toEqual(["imported-page-2", "imported-page-3", "imported-page-3", 2]);
	expect(
		imported?.pages.slice(1).map((p) => p.keys[0]?.config.actions?.[0]?.value),
	).toEqual(["imported-page-1", "imported-page-1"]);
	for (const [code, destination] of [
		["1,1", "imported-page-2"],
		["1,2", "imported-page-3"],
		["1,3", "imported-page-3"],
	] as const) {
		await act(async () =>
			button(f.host, code).dispatchEvent(
				new MouseEvent("dblclick", { bubbles: true }),
			),
		);
		await settle(() =>
			expect(query(f.host, "#keys-page", HTMLSelectElement).value).toBe(
				destination,
			),
		);
		await act(async () =>
			button(f.host, "1,1").dispatchEvent(
				new MouseEvent("dblclick", { bubbles: true }),
			),
		);
		await settle(() =>
			expect(query(f.host, "#keys-page", HTMLSelectElement).value).toBe(
				"imported-page-1",
			),
		);
	}
	expect(f.stored().profiles.slice(0, existing.length)).toEqual(existing);
	expect(imported?.compatibility?.source).toEqual(source);
	expect(
		f.calls.filter((c) => c.type === "activate" || c.type === "save"),
	).toHaveLength(0);
});

for (const selfCycle of [false, true])
	it(`quarantines imported ${selfCycle ? "self" : "two-folder"} cycles before editor navigation`, async () => {
		const f = await gridFixture([]);
		const source = {
			id: "source",
			name: "Cyclic folders",
			revision: 0,
			pages: [
				{
					id: "a",
					keys: [
						gridKey("1,1", "createFolder", {
							actions: [{ type: "folder", value: selfCycle ? "a" : "b" }],
						}),
					],
				},
				...(selfCycle
					? []
					: [
							{
								id: "b",
								keys: [
									gridKey("1,1", "emojiFolder", {
										actions: [{ type: "emojiFolderId", value: "a" }],
									}),
								],
							},
						]),
			],
		};
		const text = JSON.stringify(source);
		const report = inspectProfileText(text);
		expect(report.profile).toBeDefined();
		expect(
			report.diagnostics.filter((d) => d.code === "invalid-action"),
		).toEqual(
			source.pages.map((_, i) => ({
				code: "invalid-action",
				path: `pages.${i}.keys.0.config.actions.0.value`,
				blocking: false,
			})),
		);
		await input(query(f.host, "#keys-import-json", HTMLTextAreaElement), text);
		await click(button(f.host, "Inspect import"));
		await settle(() =>
			expect(
				query(f.host, "#keys-confirm-import", HTMLButtonElement).disabled,
			).toBe(false),
		);
		await click(button(f.host, "Import as new profile"));
		await settle(() =>
			expect(query(f.host, "#keys-profile", HTMLSelectElement).value).toBe(
				"imported",
			),
		);
		const imported = f.stored().profiles.find((p) => p.id === "imported");
		expect(imported?.compatibility?.source).toEqual(source);
		for (const [i, page] of source.pages.entries()) {
			expect(imported?.pages[i]?.keys[0]?.config.actions?.[0]?.value).toBe("");
			expect(imported?.pages[i]?.keys[0]?.compatibility).toMatchObject({
				unsupported: true,
				source: page.keys[0],
			});
			await input(
				query(f.host, "#keys-page", HTMLSelectElement),
				`imported-page-${i + 1}`,
			);
			await settle(() =>
				expect(f.stored().activeByDevice["desktop-preview"]?.pageId).toBe(
					`imported-page-${i + 1}`,
				),
			);
			const selections = f.calls.filter((c) => c.type === "select").length;
			await act(async () =>
				button(f.host, "1,1").dispatchEvent(
					new MouseEvent("dblclick", { bubbles: true }),
				),
			);
			expect(query(f.host, "#keys-page", HTMLSelectElement).value).toBe(
				`imported-page-${i + 1}`,
			);
			expect(f.calls.filter((c) => c.type === "select")).toHaveLength(
				selections,
			);
		}
		expect(
			f.calls.filter((c) => c.type === "activate" || c.type === "save"),
		).toHaveLength(0);
	});

it("does not follow a quarantined folder even when its destination is valid", async () => {
	const key = {
		...gridKey("1,1", "createFolder", {
			actions: [{ type: "folder", value: "child" }],
		}),
		compatibility: { unsupported: true },
	};
	const f = await gridFixture([key], [{ id: "child", keys: [] }]);
	const selections = f.calls.filter((c) => c.type === "select").length;
	await act(async () =>
		button(f.host, "1,1").dispatchEvent(
			new MouseEvent("dblclick", { bubbles: true }),
		),
	);
	expect(query(f.host, "#keys-page", HTMLSelectElement).value).toBe("one");
	expect(f.calls.filter((c) => c.type === "select")).toHaveLength(selections);
});

it("diagnoses unresolved imported navigation without binding it to existing or newly allocated pages", async () => {
	const f = await gridFixture([]);
	const keys = [
		gridKey("1,1", "createFolder", {
			actions: [{ type: "folder", value: "imported-page-2" }],
		}),
		gridKey("1,2", "emojiFolder", {
			actions: [{ type: "emojiFolderId", value: "subfolder" }],
		}),
		gridKey("1,3", "back", {
			actions: [{ type: "parentFolder", value: "imported-page-1" }],
		}),
		gridKey("1,4", "emojiBack", {
			actions: [{ type: "page", value: "missing" }],
		}),
	];
	const source = JSON.stringify({
		id: "source",
		name: "Broken links",
		revision: 0,
		pages: [
			{ id: "root", keys },
			{ id: "child", keys: [] },
		],
	});
	const report = inspectProfileText(source);
	expect(
		report.diagnostics
			.filter((d) => d.code === "invalid-action")
			.map((d) => d.path),
	).toEqual(keys.map((_, i) => `pages.0.keys.${i}.config.actions.0.value`));
	await input(query(f.host, "#keys-import-json", HTMLTextAreaElement), source);
	await click(button(f.host, "Inspect import"));
	await settle(() =>
		expect(
			query(f.host, "#keys-confirm-import", HTMLButtonElement).disabled,
		).toBe(false),
	);
	await click(button(f.host, "Import as new profile"));
	await settle(() =>
		expect(query(f.host, "#keys-profile", HTMLSelectElement).value).toBe(
			"imported",
		),
	);
	const imported = f.stored().profiles.find((p) => p.id === "imported");
	const selections = f.calls.filter((c) => c.type === "select").length;
	for (const [i, key] of keys.entries()) {
		expect(imported?.pages[0].keys[i]?.config.actions?.[0]?.value).toBe("");
		expect(imported?.pages[0].keys[i]?.compatibility).toMatchObject({
			unsupported: true,
			source: key,
		});
		await act(async () =>
			button(f.host, key.keyCode).dispatchEvent(
				new MouseEvent("dblclick", { bubbles: true }),
			),
		);
		expect(query(f.host, "#keys-page", HTMLSelectElement).value).toBe(
			"imported-page-1",
		);
	}
	expect(f.calls.filter((c) => c.type === "select")).toHaveLength(selections);
	expect(
		f.calls.filter((c) => c.type === "activate" || c.type === "save"),
	).toHaveLength(0);
});

it("MGMT-081 coalesces library search at 500ms and cancels pending work on unmount", async () => {
	const f = await gridFixture([]);
	vi.useFakeTimers();
	try {
		await input(
			query(f.host, "#keys-library-search", HTMLInputElement),
			"countdown",
		);
		await input(
			query(f.host, "#keys-library-search", HTMLInputElement),
			"timer",
		);
		await act(async () => vi.advanceTimersByTimeAsync(499));
		expect(f.host.querySelector('[data-library-type="hotkey"]')).not.toBeNull();
		await act(async () => vi.advanceTimersByTimeAsync(1));
		expect(f.host.querySelector('[data-library-type="hotkey"]')).toBeNull();
		expect(f.host.querySelector('[data-library-type="timer"]')).not.toBeNull();
		await input(
			query(f.host, "#keys-library-search", HTMLInputElement),
			"hotkey",
		);
		const calls = f.calls.length;
		await f.close();
		await act(async () => vi.advanceTimersByTimeAsync(1500));
		expect(f.host.textContent).toBe("");
		expect(f.calls.length).toBe(calls);
	} finally {
		vi.useRealTimers();
	}
});

it("SCREEN-135 exposes vivid configuration for the selected serial/profile without key execution", async () => {
	const f = await gridFixture([gridKey("1,1", "colorfulScreen")]);
	expect(button(f.host, "1,1").closest("fieldset")?.disabled).toBe(false);
	await click(query(f.host, ".keys-vivid-configure", HTMLButtonElement));
	await settle(() =>
		expect(
			f.host.querySelector(
				'[data-profile-id="p"][data-serial="desktop-preview"]',
			),
		).not.toBeNull(),
	);
	expect(f.calls.filter((c) => c.type === "activate")).toHaveLength(0);
});

it("MGMT-068 placed hotkeys retain held input through KeyRuntime activation", async () => {
	const f = await gridFixture([]);
	await libraryPlace(f.host, "hotkey", "1,1");
	await settle(() => expect(f.stored().profiles[0].revision).toBe(1));
	await input(query(f.host, "#key-action-0", HTMLInputElement), "control+a");
	await click(button(f.host, "Save"));
	await settle(() => expect(f.stored().profiles[0].revision).toBe(2));
	const edges: string[] = [];
	const runtime = ManagedRuntime.make(
		KeyRuntime.DefaultWithoutDependencies.pipe(
			Layer.provide(
				Layer.succeed(KeyRuntimePort, {
					read: Effect.sync(() =>
						Schema.decodeUnknownSync(ProfileEnvelope)(f.stored()),
					),
					execute: () =>
						Effect.sync(() => {
							edges.push("execute");
						}),
					holdHotkey: () =>
						Effect.sync(() => {
							edges.push("down");
							return Effect.sync(() => {
								edges.push("up");
							});
						}),
					publish: () => Effect.void,
					select: () => Effect.void,
					alarm: () => Effect.void,
				}),
			),
		),
	);
	cleanups.push(() => runtime.dispose());
	await runtime.runPromise(
		KeyRuntime.activate("desktop-preview", "1,1", "down"),
	);
	await runtime.runPromise(
		KeyRuntime.activate("desktop-preview", "1,1", "down"),
	);
	expect(edges).toEqual(["down"]);
	await runtime.runPromise(KeyRuntime.activate("desktop-preview", "1,1", "up"));
	expect(edges).toEqual(["down", "up"]);
	expect(f.stored().profiles[0].pages[0].keys[0]?.config.supportKnob).toBe(
		false,
	);
});

it("MGMT-061 clock theme refresh keeps the mounted selection and reads the saved revision", async () => {
	let snapshot: ClockSnapshot = {
		target: { profileId: "p", pageId: "one", keyCode: "1,1" },
		revision: 0,
		keyCode: "1,1",
		mode: "theme",
		themeId: "season",
		showSeconds: true,
		media: {},
		recovered: false,
	};
	let saveTheme = async (_command: ClockCommand): Promise<void> => {};
	vi.stubGlobal("quakeClock", {
		request: async (command: ClockCommand) => {
			if (command._tag === "setTheme") await saveTheme(command);
			return { _tag: "success", snapshot };
		},
		onSnapshot: () => () => {},
	});
	const f = await gridFixture([gridKey("1,1", "dkDesktopClock")]);
	saveTheme = async (command) => {
		if (command._tag !== "setTheme" || command.themeId !== "cyber")
			throw new Error("Expected next clock theme");
		snapshot = {
			...snapshot,
			revision: snapshot.revision + 1,
			themeId: "cyber",
			change: "setTheme",
		};
		await f.runtime.runPromise(
			Effect.flatMap(ProfileRepository, (repository) =>
				repository.transact((envelope) =>
					Effect.succeed({
						...envelope,
						profiles: EffectArray.map(envelope.profiles, (profile) =>
							profile.id !== "p"
								? profile
								: {
										...profile,
										revision: snapshot.revision,
										pages: EffectArray.map(profile.pages, (page) => ({
											...page,
											keys: page.keys.map((key) =>
												patchClockEditorKey(key, snapshot),
											),
										})),
									},
						),
					}),
				),
			),
		);
	};
	await f.select();
	await settle(() =>
		expect(button(f.host, "Next clock theme").disabled).toBe(false),
	);
	await click(button(f.host, "Next clock theme"));
	await settle(() => expect(f.stored().profiles[0].revision).toBe(1));
	await settle(() => expect(f.host.querySelector("#key-title")).not.toBeNull());
	expect(button(f.host, "1,1").getAttribute("aria-pressed")).toBe("true");
	expect(button(f.host, "Next clock theme").disabled).toBe(false);
	await input(
		query(f.host, "#key-title", HTMLInputElement),
		"Clock after theme",
	);
	await click(button(f.host, "Save"));
	await settle(() => expect(f.stored().profiles[0].revision).toBe(2));
	expect(f.stored().profiles[0].pages[0].keys[0]?.config.title.text).toBe(
		"Clock after theme",
	);
	await click(button(f.host, "1,1"));
	expect(f.host.querySelector("#key-title")).toBeNull();
});

it("MGMT-286 selected-key wallpaper host preserves serial and keeps key Save out of wallpaper drafts", async () => {
	const f = await fixture({
		configure: (value) => ({
			...value,
			profiles: EffectArray.map(value.profiles, (profile) =>
				profile.id !== "p"
					? profile
					: {
							...profile,
							pages: EffectArray.map(profile.pages, (page) => ({
								...page,
								keys: page.keys.map((key) => ({
									...key,
									childrenName: "colorfulScreenSettings",
									config: {
										...key.config,
										type: "colorfulScreenSettings",
										actions: [],
									},
								})),
							})),
						},
			),
		}),
	});
	await f.device("MOCK-WALLPAPER-B");
	await f.select();
	const editor = query(
		f.host,
		'.wallpaper-settings[data-serial="MOCK-WALLPAPER-B"]',
		HTMLElement,
	);
	await input(
		query(editor, 'select[aria-label="Background method"]', HTMLSelectElement),
		"transparent",
	);
	expect(f.wallpaperCalls.filter((command) => command._tag === "save")).toEqual(
		[],
	);
	await click(button(editor, "Save"));
	expect(f.wallpaperCalls).toContainEqual(
		expect.objectContaining({
			_tag: "save",
			serial: "MOCK-WALLPAPER-B",
			settings: expect.objectContaining({ isTransparent: true }),
		}),
	);
	expect(f.calls.filter((command) => command.type === "save")).toEqual([]);
});

it("MGMT-386/387/388 places reusable presets through validated profile publication without consuming the library", async () => {
	const f = await gridFixture([]);
	await libraryPlace(f.host, "apps:Discord:2", "1,2");
	await settle(() =>
		expect(
			f.stored().profiles[0].pages[0].keys.find((key) => key.keyCode === "1,2")
				?.config.actions,
		).toEqual([{ type: "key", value: "control+alt+leftbracket" }]),
	);
	await click(
		query(
			f.host,
			".keys-cells button[data-drop-code='1,2']",
			HTMLButtonElement,
		),
	);
	// Clicking the selected key clears selection, restoring the ordinary library.
	await libraryPlace(f.host, "apps:Premiere Pro:4", "2,5");
	await settle(() =>
		expect(
			f.stored().profiles[0].pages[0].keys.find((key) => key.keyCode === "2,5")
				?.config.actions,
		).toEqual([
			{ type: "key", value: "alt+left" },
			{ type: "key", value: "alt+right" },
		]),
	);
	expect(
		f.stored().profiles[0].pages[0].keys.find((key) => key.keyCode === "2,5")
			?.config.supportKnob,
	).toBe(true);
	expect(
		f.host.querySelector('[data-library-type="apps:Premiere Pro:3"]'),
	).not.toBeNull();
	expect(defaultAppLibrary()[1]?.children[4]?.keyCode).toBe("1,4");
});
it("MGMT-109/124 generated placement confirms replacements and refuses locked return cells", async () => {
	vi.stubGlobal("quakeIntegrations", {
		request: async () => ({
			type: "libraries",
			libraries: [
				{
					id: "g",
					name: "Generated",
					app: "Editor",
					createdAt: "now",
					rows: [{ id: "r", name: "Save", app: "Editor", chord: "control+s" }],
				},
			],
		}),
	});
	const f = await gridFixture([
		gridKey("1,1"),
		gridKey("1,2", "back"),
		gridKey("1,3", "meetingRecordMark", {
			basicEditableItems: { allowDelete: false },
		}),
	]);
	await pointerMove(
		f.host,
		query(f.host, '[data-library-type="generated:g:r"]', HTMLButtonElement),
		"1,1",
	);
	await settle(() =>
		expect(f.host.querySelector('[role="alertdialog"]')).not.toBeNull(),
	);
	expect(f.stored().profiles[0].pages[0].keys[0]?.config.actions).toEqual([
		{ type: "key", value: "a" },
	]);
	await click(button(f.host, "Cancel"));
	expect(f.stored().profiles[0].revision).toBe(0);
	for (const code of ["1,2", "1,3"]) {
		await pointerMove(
			f.host,
			query(f.host, '[data-library-type="generated:g:r"]', HTMLButtonElement),
			code,
		);
		expect(f.stored().profiles[0].revision).toBe(0);
	}
	await pointerMove(
		f.host,
		query(f.host, '[data-library-type="generated:g:r"]', HTMLButtonElement),
		"1,1",
	);
	await settle(() =>
		expect(f.host.querySelector('[role="alertdialog"]')).not.toBeNull(),
	);
	await click(button(f.host, "Confirm replacement"));
	await settle(() =>
		expect(
			f.stored().profiles[0].pages[0].keys.find((key) => key.keyCode === "1,1")
				?.config.actions,
		).toEqual([{ type: "key", value: "control+s" }]),
	);
});
it("MGMT-124 bounds generated placement titles while retaining searchable full library names", async () => {
	const names = [
		"Toggle Full Screen Mode",
		"一二三四五六七八九十十一",
		"123456789012345678😀tail",
	];
	vi.stubGlobal("quakeIntegrations", {
		request: async () => ({
			type: "libraries",
			libraries: [
				{
					id: "g",
					name: "Generated",
					app: "Editor",
					createdAt: "now",
					rows: names.map((name, i) => ({
						id: String(i),
						name,
						app: "Editor",
						chord: "control+s",
					})),
				},
			],
		}),
	});
	const f = await gridFixture([]);
	const expected = [
		"Toggle Full Screen M",
		"一二三四五六七八九十",
		"123456789012345678😀",
	];
	for (const [i, name] of names.entries()) {
		const selector = `[data-library-type="generated:g:${i}"]`;
		expect(query(f.host, selector, HTMLButtonElement).textContent).toContain(
			name,
		);
		await pointerMove(
			f.host,
			query(f.host, selector, HTMLButtonElement),
			`1,${i + 1}`,
		);
		await settle(() => expect(f.stored().profiles[0].revision).toBe(i + 1));
		expect(
			f
				.stored()
				.profiles[0].pages[0].keys.find((key) => key.keyCode === `1,${i + 1}`)
				?.config.title.text,
		).toBe(expected[i]);
	}
	await input(query(f.host, "#keys-library-search", HTMLInputElement), "Mode");
	await settle(() => {
		expect(
			f.host.querySelector('[data-library-type="generated:g:1"]'),
		).toBeNull();
		expect(
			f.host.querySelector('[data-library-type="generated:g:0"]')?.textContent,
		).toContain(names[0]);
	});
});
it("MGMT-124 converts stored Windows modifiers for generated grid placement and sequence availability", async () => {
	vi.stubGlobal("quakeIntegrations", {
		request: async () => ({
			type: "libraries",
			libraries: [
				{
					id: "g",
					name: "Generated",
					app: "Editor",
					createdAt: "now",
					rows: ["meta+s", "right_meta+s"].map((chord, i) => ({
						id: String(i),
						name: `Save ${i}`,
						app: "Editor",
						chord,
					})),
				},
			],
		}),
	});
	const f = await fixture();
	for (const [i, value] of ["super+s", "right_super+s"].entries()) {
		await pointerMove(
			f.host,
			query(
				f.host,
				`[data-library-type="generated:g:${i}"]`,
				HTMLButtonElement,
			),
			`1,${i + 2}`,
		);
		await settle(() => expect(f.stored().profiles[0].revision).toBe(i + 1));
		expect(
			f
				.stored()
				.profiles[0].pages[0].keys.find((key) => key.keyCode === `1,${i + 2}`)
				?.config.actions,
		).toEqual([{ type: "key", value }]);
	}
	await click(button(f.host, "1,1"));
	for (const i of [0, 1]) {
		const entry = query(
			f.host,
			`[data-library-type="generated:g:${i}"]`,
			HTMLButtonElement,
		);
		expect(entry.disabled).toBe(false);
	}
	expect(f.stored().profiles[0].revision).toBe(2);
});
it("MGMT-109 registry placement retains OBS default locks rather than empty-cell defaults", async () => {
	const f = await gridFixture([]);
	await libraryPlace(f.host, "obsStats", "1,1");
	await settle(() =>
		expect(f.stored().profiles[0].pages[0].keys[0]?.config.size).toEqual([
			2, 1,
		]),
	);
	expect(
		f.stored().profiles[0].pages[0].keys[0]?.config.basicEditableItems,
	).toMatchObject({ title: false, grid: false, icon: false });
});
it("MGMT-302/306 keeps knob and key agent route IDs and labels distinct", async () => {
	const f = await fixture({ agentKey: true });
	await input(query(f.host, "#knob-function", HTMLSelectElement), "assistant");
	await input(query(f.host, "#knob-route", HTMLSelectElement), "dkclaw");
	await f.select();
	const routes = [
		...f.host.querySelectorAll<HTMLSelectElement>('select[id*="local-agent"]'),
	];
	expect(routes).toHaveLength(4);
	expect(new Set(routes.map((route) => route.id)).size).toBe(4);
	for (const route of routes) {
		const label = f.host.querySelector<HTMLLabelElement>(
			`label[for="${route.id}"]`,
		);
		expect(label?.control).toBe(route);
	}
	const knob = query(f.host, "#knob-local-agent", HTMLSelectElement);
	const key = query(f.host, "#key-local-agent", HTMLSelectElement);
	await input(key, "writer");
	expect(knob.value).toBe("main");
	await input(knob, "writer");
	await input(key, "main");
	expect(knob.value).toBe("writer");
});

it("MGMT-127 blocks the 101st library operation with feedback and preserves a saveable sequence", async () => {
	const f = await gridFixture([
		gridKey("1,1", "multiActions", {
			subActions: Array.from({ length: 99 }, (_, i) => ({
				config: { type: "delay", actions: [{ type: "time", value: i }] },
			})),
		}),
	]);
	await f.select();
	const delay = () =>
		query(f.host, '[data-library-type="delay"]', HTMLButtonElement);
	await click(delay());
	expect(f.host.querySelectorAll(".key-sequence-step")).toHaveLength(100);
	await click(delay());
	expect(f.host.querySelectorAll(".key-sequence-step")).toHaveLength(100);
	expect(f.host.textContent).toContain(
		"Max configurations reached, please delete first.",
	);
	expect(f.stored().profiles[0].revision).toBe(0);
	await click(button(f.host, "Save"));
	await settle(() => expect(f.stored().profiles[0].revision).toBe(1));
	expect(
		f.stored().profiles[0].pages[0].keys[0]?.config.subActions,
	).toHaveLength(100);
	expect(f.writes()).toBe(1);
});

it("MGMT-121 keeps an unmarked renamed preset on the saved grid and localized editor after placement", async () => {
	const groups = defaultAppLibrary();
	const renamed = groups.map((group, i) =>
		i
			? group
			: {
					...group,
					children: group.children.map((key, j) =>
						j
							? key
							: {
									...key,
									config: {
										...key.config,
										title: { ...key.config.title, text: "My mute" },
									},
								},
					),
				},
	);
	const f = await fixture({
		appGroups: renamed,
		configure: (value) => ({
			...value,
			profiles: [
				{ ...value.profiles[0], pages: [{ id: "one", keys: [] }] },
				...value.profiles.slice(1),
			],
		}),
	});
	await libraryPlace(f.host, "apps:Discord:0", "1,2");
	await settle(() => expect(f.stored().profiles[0].revision).toBe(1));
	const key = f
		.stored()
		.profiles[0].pages[0].keys.find((key) => key.keyCode === "1,2");
	expect(key?.config.title.text).toBe("My mute");
	expect(query(f.host, "#key-title", HTMLInputElement).value).toBe("My mute");
	expect(
		f.host.querySelector('[data-key-code="1,2"] .strip-tile-title')
			?.textContent,
	).toBe("My mute");
	await input(query(f.host, "#keys-language", HTMLSelectElement), "de");
	expect(query(f.host, "#key-title", HTMLInputElement).value).toBe("My mute");
	expect(
		f.host.querySelector('[data-key-code="1,2"] .strip-tile-title')
			?.textContent,
	).toBe("My mute");
});

it("review: mounted Close sequence draft edits path, retains force and saves", async () => {
	const f = await fixture();
	await f.select();
	const step = query(f.host, ".key-sequence-step", HTMLDivElement);
	const select = query(step, "select", HTMLSelectElement);
	await act(async () => {
		select.value = "close";
		select.dispatchEvent(new Event("change", { bubbles: true }));
	});
	await input(
		query(step, 'input[type="text"]', HTMLInputElement),
		"/Applications/Synthetic.app",
	);
	await click(button(f.host, "Save"));
	await settle(() =>
		expect(f.host.textContent).toContain("Saved successfully"),
	);
	expect(
		f.stored().profiles[0].pages[0].keys[0]?.config.subActions?.[0],
	).toMatchObject({
		config: {
			type: "close",
			actions: [
				{ type: "path", value: "/Applications/Synthetic.app" },
				{ type: "force", value: 0 },
			],
		},
	});
});

it("MGMT-401 uses only typed profile/page selects for switch-profile keys", async () => {
	const f = await fixture({
		configure: (envelope) => ({
			...envelope,
			profiles: EffectArray.map(envelope.profiles, (profile) => ({
				...profile,
				pages: EffectArray.map(profile.pages, (page) => ({
					...page,
					keys: page.keys.map((key) =>
						key.keyCode === "1,1"
							? {
									...key,
									childrenName: "switchProfile",
									config: {
										...key.config,
										type: "switchProfile",
										actions: [
											{ type: "profile", value: "p" },
											{ type: "page", value: 1 },
										],
									},
								}
							: key,
					),
				})),
			})),
		}),
	});
	await f.select();
	expect(f.host.querySelector('[aria-label="Switch profile"]')).not.toBeNull();
	expect(
		f.host.querySelector('[aria-label="Switch profile page"]'),
	).not.toBeNull();
	expect(f.host.querySelectorAll('input[id^="key-action-"]')).toHaveLength(0);
	expect(f.host.querySelector('option[value="-1"]')?.textContent).toBe(
		"Next profile",
	);
});

it("AI-334 enables meeting viewer size controls and saves an alternate span", async () => {
	const f = await gridFixture([
		gridKey("1,1", "liveAudioTranslateDisplay", { size: [5, 2] }),
	]);
	await f.select();
	const span = query(f.host, "#key-span", HTMLSelectElement);
	expect(span.disabled).toBe(false);
	await input(span, "3,1");
	await click(button(f.host, "Save"));
	await settle(() =>
		expect(f.stored().profiles[0].pages[0].keys[0]?.config.size).toEqual([
			3, 1,
		]),
	);
});

for (const state of ["hidden", "deleted"] as const) {
	it(`review: switch-profile editor displays its saved ${state} destination`, async () => {
		const f = await fixture({
			configure: (envelope) =>
				Schema.encodeSync(ProfileEnvelope)(
					Schema.decodeUnknownSync(ProfileEnvelope)({
						...envelope,
						manager: {
							revision: 0,
							installed: true,
							userHasSetDefault: false,
							approvedCommands: [],
							hidden: state === "hidden" ? ["destination"] : [],
							links: [],
						},
						profiles: [
							...envelope.profiles.map((profile) => ({
								...profile,
								pages: profile.pages.map((page) => ({
									...page,
									keys: page.keys.map((key) =>
										key.keyCode === "1,1"
											? {
													...key,
													childrenName: "switchProfile",
													config: {
														...key.config,
														type: "switchProfile",
														actions: [
															{ type: "profile", value: "destination" },
															{ type: "page", value: 1 },
														],
													},
												}
											: key,
									),
								})),
							})),
							...(state === "hidden"
								? [
										{
											id: "destination",
											name: "Hidden destination",
											revision: 0,
											pages: [{ id: "one", keys: [] }],
										},
									]
								: []),
						],
					}),
				),
		});
		await f.select();
		const select = query(
			f.host,
			'[aria-label="Switch profile"]',
			HTMLSelectElement,
		);
		expect(select.value).toBe("destination");
		const saved = select.selectedOptions[0];
		expect(saved?.disabled).toBe(true);
		expect(saved?.textContent).toBe(
			state === "hidden" ? "Hidden destination" : "destination",
		);
		expect(
			query(f.host, '[aria-label="Switch profile page"]', HTMLSelectElement)
				.disabled,
		).toBe(true);
		expect(select.querySelector('option[value="-1"]')?.textContent).toBe(
			"Next profile",
		);
		expect(
			select.querySelector<HTMLOptionElement>('option[value="p"]')?.disabled,
		).toBe(false);
		expect(f.stored().profiles[0].pages[0].keys[0]?.config.actions).toEqual([
			{ type: "profile", value: "destination" },
			{ type: "page", value: 1 },
		]);
	});
}

for (const occupied of [false, true]) {
	it(`saved Quick key move/swap controls ignore all legacy locks, occupied=${occupied}`, async () => {
		const quick = builtinProfiles("darwin").find((p) => p.id === "1-2");
		const source = quick?.pages[0].keys.find((k) => k.keyCode === "1,4");
		const other = quick?.pages[0].keys.find((k) => k.keyCode === "1,5");
		if (!source || !other) throw new Error("Missing Quick keys");
		const one = Schema.encodeSync(ProfileKey)(source);
		const two = { ...Schema.encodeSync(ProfileKey)(other), keyCode: "2,8" };
		const f = await gridFixture([one, ...(occupied ? [two] : [])]);
		await click(button(f.host, "1,4"));
		expect(query(f.host, "#key-destination", HTMLSelectElement).disabled).toBe(
			false,
		);
		expect(query(f.host, "#key-title", HTMLInputElement).disabled).toBe(false);
		expect(query(f.host, "#key-span", HTMLSelectElement).disabled).toBe(false);
		expect(button(f.host, "Delete").disabled).toBe(false);
		await input(query(f.host, "#key-title", HTMLInputElement), "My Quick key");
		await input(query(f.host, "#key-destination", HTMLSelectElement), "2,8");
		await click(button(f.host, "Save"));
		await settle(() => expect(f.stored().profiles[0].revision).toBe(1));
		expect(
			f.stored().profiles[0].pages[0].keys.find((k) => k.keyCode === "2,8")
				?.config,
		).toMatchObject({
			title: { text: "My Quick key" },
			basicEditableItems: one.config.basicEditableItems,
		});
		if (occupied)
			expect(
				f.stored().profiles[0].pages[0].keys.find((k) => k.keyCode === "1,4")
					?.config,
			).toEqual(two.config);
	});
}
it("MGMT-249 retains structural outside-field Delete protection", async () => {
	const f = await gridFixture([
		gridKey("1,1", "meetingRecordMark", {
			basicEditableItems: { allowDelete: false },
		}),
	]);
	await click(button(f.host, "1,1"));
	await act(async () =>
		window.dispatchEvent(new KeyboardEvent("keyup", { key: "Delete" })),
	);
	expect(f.calls.filter((c) => c.type === "delete")).toHaveLength(0);
	expect(f.stored().profiles[0].revision).toBe(0);
});
it("a structural swap destination explains rejection and preserves the committed profile", async () => {
	const f = await gridFixture([
		gridKey("1,1", "hotkey"),
		gridKey("1,2", "meetingRecordMark", {
			basicEditableItems: { allowDelete: false },
		}),
	]);
	await click(button(f.host, "1,1"));
	await input(query(f.host, "#key-destination", HTMLSelectElement), "1,2");
	expect(f.host.textContent).toContain(
		"This tile has structural protection and cannot be replaced or swapped.",
	);
	await click(button(f.host, "Save"));
	expect(f.host.textContent).toContain(
		"This tile has structural protection and cannot be replaced or swapped.",
	);
	expect(f.stored().profiles[0].revision).toBe(0);
});
it("Vivid retains configuration access and exposes editable title/icon/move with protected resize/delete", async () => {
	const f = await gridFixture([gridKey("1,1", "colorfulScreen")]);
	await click(button(f.host, "1,1"));
	expect(query(f.host, "#key-title", HTMLInputElement).disabled).toBe(false);
	expect(query(f.host, "#key-destination", HTMLSelectElement).disabled).toBe(
		false,
	);
	expect(query(f.host, "#key-span", HTMLSelectElement).disabled).toBe(true);
	expect(button(f.host, "Delete").disabled).toBe(true);
});

it("keeps the knob revision current across repeated saves and a subsequent key save", async () => {
	const f = await gridFixture([gridKey("1,1")]);
	await input(query(f.host, "#knob-function", HTMLSelectElement), "nextPage");
	await click(button(f.host, "Save knob"));
	await settle(() => expect(f.stored().profiles[0].revision).toBe(1));
	await input(
		query(f.host, "#knob-function", HTMLSelectElement),
		"previousPage",
	);
	await click(button(f.host, "Save knob"));
	await settle(() => expect(f.stored().profiles[0].revision).toBe(2));
	const beforeKeySave = f.stored().profiles[0];
	const knobBeforeKeySave = beforeKeySave.knob;
	await click(button(f.host, "1,1"));
	await input(query(f.host, "#key-title", HTMLInputElement), "Edited");
	await click(button(f.host, "Save"));
	expect(f.stored().profiles[0].knob).toEqual(knobBeforeKeySave);
	expect(
		knobDraftRevision(
			Schema.decodeUnknownSync(Profile)(beforeKeySave),
			Schema.decodeUnknownSync(Profile)(f.stored().profiles[0]),
		),
	).toBe(3);
	await click(
		button(query(f.host, ".group:has(#key-title)", HTMLElement), "Cancel"),
	);
	await click(button(f.host, "Save knob"));
	expect(
		f.calls.filter((call) => call.type === "save-knob").at(-1),
	).toMatchObject({ revision: 3 });
	await settle(() => expect(f.stored().profiles[0].revision).toBe(4));
});

it("edits a legacy empty force flag as a number and saves the generic action", async () => {
	const f = await gridFixture([
		gridKey("1,1", "close", {
			actions: [
				{ type: "path", value: "/Applications/Example.app" },
				{ type: "force", value: "" },
			],
		}),
	]);
	await click(button(f.host, "1,1"));
	await input(query(f.host, "#key-action-1", HTMLInputElement), "1");
	await click(button(f.host, "Save"));
	await settle(() => expect(f.stored().profiles[0].revision).toBe(1));
	expect(f.stored().profiles[0].pages[0]?.keys[0]?.config.actions?.[1]).toEqual(
		{
			type: "force",
			value: 1,
		},
	);
});

it("rejects moving a hidden key into a displayed wide tile and keeps the original selection", async () => {
	const hidden = gridKey("1,1", "hotkey", { display: false });
	const wide = gridKey("1,4", "hotkey", { size: [2, 1] });
	const f = await gridFixture([hidden, wide]);
	await click(button(f.host, "1,1"));
	await input(query(f.host, "#key-destination", HTMLSelectElement), "1,5");
	await click(button(f.host, "Save"));
	expect(f.stored().profiles[0].revision).toBe(0);
	expect(button(f.host, "1,1").getAttribute("aria-pressed")).toBe("true");
	expect(f.stored().profiles[0].pages[0].keys).toEqual([hidden, wide]);
});

it("keeps a hidden moved key selected for subsequent saves", async () => {
	const hidden = gridKey("1,1", "hotkey", { display: false });
	const f = await gridFixture([hidden]);
	await click(button(f.host, "1,1"));
	await input(query(f.host, "#key-destination", HTMLSelectElement), "1,5");
	await click(button(f.host, "Save"));
	expect(button(f.host, "1,5").getAttribute("aria-pressed")).toBe("true");
	await input(query(f.host, "#key-title", HTMLInputElement), "Still hidden");
	await click(button(f.host, "Save"));
	expect(f.stored().profiles[0].pages[0].keys).toEqual([
		{
			...hidden,
			keyCode: "1,5",
			config: {
				...hidden.config,
				title: {
					...hidden.config.title,
					text: "Still hidden",
					pos: "top",
					style: "",
				},
				userModifiedTitle: true,
			},
		},
	]);
});

it("moves the existing Vivid tile from an enabled cell button", async () => {
	const vivid = gridKey("1,1", "colorfulScreen");
	const f = await gridFixture([vivid]);
	await pointerMove(f.host, button(f.host, "1,1"), "2,8");
	await settle(() => expect(f.stored().profiles[0].revision).toBe(1));
	expect(f.stored().profiles[0].pages[0].keys).toEqual([
		{ ...vivid, keyCode: "2,8" },
	]);
});

it("saves the visible action's original index when hidden actions precede it", async () => {
	const f = await gridFixture([
		gridKey("1,1", "text", {
			actions: [
				{ type: "musicSource", value: "legacy" },
				{ type: "text", value: "Before" },
			],
		}),
	]);
	await click(button(f.host, "1,1"));
	await input(query(f.host, "#key-action-1", HTMLInputElement), "After");
	expect(
		f.calls.filter((call) => call.type === "preview").at(-1),
	).toMatchObject({
		key: {
			config: {
				actions: [
					{ type: "musicSource", value: "legacy" },
					{ type: "text", value: "After" },
				],
			},
		},
	});
});

it("refreshes a clean knob draft when adding a page materializes the inherited knob", async () => {
	const f = await gridFixture([gridKey("1,1")]);
	await click(button(f.host, "Add page"));
	await settle(() => expect(f.stored().profiles[0].revision).toBe(1));
	await input(query(f.host, "#knob-function", HTMLSelectElement), "nextPage");
	await click(button(f.host, "Save knob"));
	await settle(() => expect(f.stored().profiles[0].revision).toBe(2));
	expect(
		f.calls.filter((call) => call.type === "save-knob").at(-1),
	).toMatchObject({ revision: 1 });
});

it("keeps an unsaved knob draft conflict-protected when page creation introduces a different knob", async () => {
	const f = await gridFixture([gridKey("1,1")]);
	await input(query(f.host, "#knob-function", HTMLSelectElement), "nextPage");
	await click(button(f.host, "Add page"));
	await settle(() => expect(f.stored().profiles[0].revision).toBe(1));
	await click(button(f.host, "Save knob"));
	expect(f.stored().profiles[0].revision).toBe(1);
	expect(f.host.textContent).toContain("QUAKE.PROFILE.REVISION_CONFLICT");
	expect(query(f.host, "#knob-function", HTMLSelectElement).value).toBe(
		"nextPage",
	);
});

it("blocks Save for an empty numeric draft and persists the corrected action", async () => {
	const f = await gridFixture([
		gridKey("1,1", "timer", {
			actions: [
				{ type: "time", value: 12 },
				{ type: "sound", value: "" },
				{ type: "callback", value: 1 },
			],
		}),
	]);
	await f.select();
	const field = query(f.host, "#key-action-0", HTMLInputElement);
	await input(field, "");
	expect(field.value).toBe("");
	expect(button(f.host, "Save").disabled).toBe(true);
	await click(button(f.host, "Save"));
	expect(f.writes()).toBe(0);
	await input(field, "24");
	expect(button(f.host, "Save").disabled).toBe(false);
	await click(button(f.host, "Save"));
	await settle(() => expect(f.writes()).toBe(1));
	expect(
		f.stored().profiles[0].pages[0].keys[0]?.config.actions,
	).toContainEqual({ type: "time", value: 24 });
});

it("changing Function removes an unmounted JSON validation blocker", async () => {
	const f = await gridFixture([
		gridKey("1,1", "emoji", {
			actions: [{ type: "emojiConfig", value: { enabled: true } }],
		}),
	]);
	await f.select();
	await input(query(f.host, "#key-action-0", HTMLTextAreaElement), "{");
	expect(button(f.host, "Save").disabled).toBe(true);
	await input(query(f.host, "#key-function", HTMLSelectElement), "nextPage");
	await settle(() => expect(button(f.host, "Save").disabled).toBe(false));
	await click(button(f.host, "Save"));
	await settle(() => expect(f.writes()).toBe(1));
	expect(f.stored().profiles[0].pages[0].keys[0]?.config.type).toBe("nextPage");
});

it("Console table selects the same real key, tracks edits, and saves through KeyEditing", async () => {
	const f = await fixture();
	await f.select();
	// Toggle through the table after selecting the same key in the mirror.
	const row = query(f.host, ".keys-table tbody button", HTMLButtonElement);
	await click(row);
	expect(f.host.querySelector("#key-title")).toBeNull();
	await click(row);
	await settle(() => expect(f.host.querySelector("#key-title")).not.toBeNull());
	await input(query(f.host, "#key-title", HTMLInputElement), "Console action");
	await settle(() =>
		expect(
			f.host.querySelector('.keys-table td[data-edited="true"]')?.textContent,
		).toBe("Edited"),
	);
	expect(f.host.querySelector(".keys-table tbody button")?.textContent).toBe(
		"Console action",
	);
	await click(button(f.host, "Save"));
	await settle(() =>
		expect(f.stored().profiles[0].pages[0].keys[0]?.config.title.text).toBe(
			"Console action",
		),
	);
	expect(f.host.querySelector('.keys-table td[data-edited="true"]')).toBeNull();
});

it("creates and selects the Console preset without replacing an existing profile", async () => {
	const f = await fixture();
	const before = f.stored().profiles[0];
	await f.device("connected-device");
	await click(button(f.host, "Create console profile"));
	await settle(() =>
		expect(f.stored().activeByDevice["desktop-preview"]?.profileId).toBe(
			"imported",
		),
	);
	expect(f.managerCalls).toContainEqual({
		type: "manage",
		command: { type: "select", id: "imported" },
	});
	expect(f.stored().activeByDevice["connected-device"]?.profileId).toBe(
		"imported",
	);
	expect(f.stored().profiles[0]).toEqual(before);
	expect(
		f.stored().profiles.find((profile) => profile.id === "imported")?.pages[0]
			.keys,
	).toHaveLength(7);
	expect(
		f.host.querySelectorAll('.keys-preview .strip-slot[data-state="tile"]'),
	).toHaveLength(7);
});

it("keeps the active profile when Console delivery is rejected and retains the imported preset", async () => {
	const f = await fixture();
	const before = f.stored().activeByDevice;
	f.setProfileManagerReply({ _tag: "rejected", reason: "delivery-failed" });
	await click(button(f.host, "Create console profile"));
	await settle(() =>
		expect(f.host.textContent).toContain(
			"This profile could not be made active on the device.",
		),
	);
	expect(f.stored().activeByDevice).toEqual(before);
	expect(f.stored().profiles.some((profile) => profile.id === "imported")).toBe(
		true,
	);
	expect(f.calls.filter((command) => command.type === "select")).toHaveLength(
		0,
	);
});

it.each(["en", "de", "zh", "ja"] as const)(
	"localizes key-size overlap confirmation in %s without saving on cancel",
	async (locale) => {
		const f = await gridFixture([gridKey("1,1"), gridKey("1,2")]);
		const before = f.stored();
		await input(query(f.host, "#keys-language", HTMLSelectElement), locale);
		await f.select();
		await input(query(f.host, "#key-span", HTMLSelectElement), "2,1");
		const dialog = query(f.host, '[role="alertdialog"]', HTMLDivElement);
		expect(dialog.getAttribute("aria-label")).toBe(
			keyText("shortcutGrid.replaceTitle", locale),
		);
		expect(dialog.textContent).toContain(
			keyText("shortcutGrid.replaceConfirm", locale).replace("{names}", "1,2"),
		);
		expect(dialog.textContent).toContain(
			keyText("shortcutGrid.confirmReplace", locale),
		);
		await click(button(dialog, keyText("cancel", locale)));
		expect(f.stored()).toEqual(before);
	},
);
