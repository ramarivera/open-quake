// @vitest-environment happy-dom
import {
	Effect,
	Array as EffectArray,
	Layer,
	ManagedRuntime,
	Option,
	Schema,
} from "effect";
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { KeyEditing } from "../../../../../../packages/device/src/profiles/key-editing-service";
import {
	builtinProfiles,
	profileLabel,
} from "../../../../../../packages/device/src/profiles/profile-catalog";
import {
	createEmptyProfileKey,
	encodeProfileEnvelope,
	ProfileEnvelope,
	ProfileKey,
} from "../../../../../../packages/device/src/profiles/profile-contracts";
import {
	ProfileRepository,
	profileStorageLayer,
} from "../../../../../../packages/device/src/profiles/profile-repository";
import { ProfileService } from "../../../../../../packages/device/src/profiles/profile-service";
import type { QuakeEvent } from "../../../preload/quake";
import { defaultClockTile, defaultWallpaper } from "../../../shared/display";
import type {
	KeyPreview,
	KeyReply,
	KeyRequest,
} from "../../../shared/key-library";
import type { MeetingsBridge } from "../../../shared/meeting-bridge";
import { readerSettings } from "../../../shared/reader-settings";
import { selectStripPage } from "../../../shared/strip-selection";
import type { WallpaperSnapshot } from "../../../shared/wallpaper-contracts";
import { button, click, input, mount, query, settle } from "../../test/dom";
import { stripLayout } from "../strip/geometry";
import { mountStripTouch } from "../strip/mount-strip-touch";
import {
	previewVoiceContext,
	type StripVoiceContext,
} from "../strip/overlays/voice/voice-context";
import { StripScreen } from "../strip/StripScreen";

import { KeyEditor } from "./KeyEditor";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
	localStorage.clear();
	vi.unstubAllGlobals();
});
async function fixture(locked = false) {
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
									childrenName: "multiActions",
									config: {
										...Schema.encodeSync(ProfileKey)(
											createEmptyProfileKey("1,1"),
										).config,
										type: "multiActions",
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
	let failWrites = false;
	let writePause: Promise<void> | undefined;
	const repository = ProfileRepository.Default.pipe(
		Layer.provide(
			profileStorageLayer({
				read: async () => stored,
				write: async (next) => {
					await writePause;
					if (failWrites) throw new Error("Synthetic disk failure");
					stored = next;
				},
			}),
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
			_tag: "rejected",
			message: "No saved providers in regression fixture",
		}),
		onSnapshot: () => () => {},
	});
	const request = async (command: KeyRequest): Promise<KeyReply> => {
		calls.push(command);
		const operation = Effect.gen(function* () {
			const editing = yield* KeyEditing;
			switch (command.type) {
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
					if (result._tag !== "ready")
						return {
							_tag: "rejected",
							reason: "layout-locked-or-invalid",
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
	vi.stubGlobal("quakeWallpaper", {
		request: async () => ({
			_tag: "success",
			snapshot: wallpaper("desktop-preview"),
		}),
		onSnapshot: (callback: (snapshot: unknown) => void) => {
			publishWallpaper = callback;
			return () => {
				publishWallpaper = undefined;
			};
		},
		onClock: () => () => {},
	});
	const mounted = await mount(<KeyEditor />);
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
		device: async (serial: string) => {
			await act(async () => publishWallpaper?.(wallpaper(serial)));
		},
		select,
		stored: () => stored,
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
	it(`MGMT-249 outside-field Delete respects edit lock=${locked}`, async () => {
		const f = await fixture(locked);
		await f.select();
		await act(async () =>
			window.dispatchEvent(new KeyboardEvent("keyup", { key: "Delete" })),
		);
		expect(f.calls.filter((c) => c.type === "delete")).toHaveLength(
			locked ? 0 : 1,
		);
		expect(f.stored().profiles[0].pages[0].keys[0]?.config.type).toBe(
			locked ? "multiActions" : "",
		);
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
