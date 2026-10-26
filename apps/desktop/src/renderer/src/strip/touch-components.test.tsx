// @vitest-environment happy-dom
import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KnobModelPorts } from "../../../../../../packages/device/src/knob/model/ports";
import { KnobModel } from "../../../../../../packages/device/src/knob/model/service";
import { builtinProfiles } from "../../../../../../packages/device/src/profiles/profile-catalog";
import type { QuakeEvent } from "../../../preload/quake";
import { defaultClockTile, defaultWallpaper } from "../../../shared/display";
import type { KeyRequest, KeyRuntimeState } from "../../../shared/key-library";
import type {
	KnobModelContext,
	KnobRequest,
} from "../../../shared/knob-contracts";
import {
	createInitialProfileEnvelope,
	encodeProfileEnvelope,
	type Profile,
	type ProfileEnvelope,
} from "../../../shared/profiles";
import { TransportButton } from "../weather-media/TransportButton";
import { stripLayout } from "./geometry";
import { mountStripTouch } from "./mount-strip-touch";
import { KnobPanelLayer } from "./overlays/knob/KnobPanelLayer";
import { VolumeCapsule } from "./overlays/knob/VolumeCapsule";
import { previewVoiceContext } from "./overlays/voice/voice-context";
import { StripPanel } from "./StripPanel";
import { StripScreen } from "./StripScreen";
import { AiCopilotTile } from "./tiles/aiCopilot/AiCopilotTile";
import { ClawBotInputTile } from "./tiles/clawBotInput/ClawBotInputTile";
import { SoundboardUnavailableTile } from "./tiles/soundboard/SoundboardUnavailableTile";
import type { StripKeyEvent } from "./touch-controller";

const roots: Root[] = [];
const disposals: Array<() => void | Promise<void>> = [];
function host() {
	const node = document.createElement("div");
	node.id = "root";
	document.body.append(node);
	const root = createRoot(node);
	roots.push(root);
	vi.spyOn(node, "getBoundingClientRect").mockReturnValue(
		new DOMRect(0, 0, 1920, 480),
	);
	return { node, root };
}
const flush = async () => {
	await act(async () => {
		await new Promise<void>((resolve) => setTimeout(resolve, 30));
	});
};
function fixtureProfile(): Profile {
	const profile = builtinProfiles("darwin")[0];
	if (!profile) throw new Error("Missing fixture");
	const original = profile.pages[0]?.keys[0];
	if (!original) throw new Error("Missing key");
	return {
		...profile,
		id: "touch-profile",
		pages: [
			{
				id: "page",
				compatibility: Option.none(),
				keys: [
					{
						...original,
						keyCode: "1,1",
						config: {
							...original.config,
							type: "vol",
							display: true,
							actions: [],
						},
					},
				],
			},
		],
	};
}
function input(
	node: HTMLElement,
	layout: ReturnType<typeof stripLayout>,
	onKey?: (event: StripKeyEvent) => void,
) {
	let callback: ((event: QuakeEvent) => void) | undefined;
	const off = vi.fn();
	const dispose = mountStripTouch(
		node,
		{
			version: "test",
			onQuakeEvent: (listener) => {
				callback = listener;
				return off;
			},
		},
		0,
		() => layout,
		onKey,
	);
	disposals.push(dispose);
	const frame = (x: number, y: number, action: 0 | 1) =>
		callback?.({
			source: "mock",
			kind: "touch",
			points: [{ x, y: 480 - y, action }],
		});
	return { frame, off };
}
beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("matchMedia", () => ({
		matches: true,
		addEventListener: () => {},
		removeEventListener: () => {},
	}));
});
afterEach(async () => {
	await act(async () => {
		for (const root of roots.splice(0)) root.unmount();
	});
	for (const dispose of disposals.splice(0).reverse()) await dispose();
	delete window.quakeKnob;
	delete window.quakeVoice;
	delete window.quakeProfiles;
	document.body.replaceChildren();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("touch production components", () => {
	it.each(["A", "B"])(
		"pins %s profile and activation to the renderer serial despite another wallpaper selection",
		async (serial) => {
			const { root } = host();
			const other = serial === "A" ? "B" : "A";
			window.history.replaceState({}, "", `?surface=panel&serial=${serial}`);
			const profileWithEmoji = (id: string): Profile => {
				const profile = fixtureProfile();
				const page = profile.pages[0];
				const key = page.keys[0];
				if (!key) throw new Error("Missing key");
				return {
					...profile,
					id,
					pages: [
						{
							...page,
							keys: [
								...page.keys,
								{
									...key,
									keyCode: "1,2",
									config: { ...key.config, type: "emoji" },
								},
							],
						},
					],
				};
			};
			const a = profileWithEmoji("profile-A");
			const b = profileWithEmoji("profile-B");
			const emojiPress = vi.fn(async () => ({ _tag: "success" as const }));
			vi.stubGlobal("quakeEmoji", { press: emojiPress });
			const envelope: ProfileEnvelope = {
				...createInitialProfileEnvelope(),
				profiles: [a, b],
				activeByDevice: {
					A: { profileId: a.id, pageId: "page" },
					B: { profileId: b.id, pageId: "page" },
				},
			};
			const listeners = new Set<(event: QuakeEvent) => void>();
			window.openQuake = {
				version: "test",
				onQuakeEvent: (listener) => {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
			};
			vi.stubGlobal("quakeDeviceReady", {
				read: async () => ({
					_tag: "ready",
					snapshot: {
						serialNumber: serial,
						connected: true,
						deviceModel: "QUAKE_HID",
						connectionType: "mock",
						session: `session-${serial}`,
						rotation: 0,
						keyMatrix: { row: 2, col: 8 },
					},
				}),
			});
			vi.stubGlobal("quakeStripTransport", {
				send: async () => ({ ok: true }),
			});
			window.quakeProfiles = {
				read: async () => ({
					_tag: "ready",
					envelope: encodeProfileEnvelope(envelope),
				}),
				onSnapshot: () => () => {},
			};
			const request = vi.fn(async (_command: KeyRequest) => ({
				_tag: "success" as const,
			}));
			window.quakeKeyLibrary = {
				request,
				onPreview: () => () => {},
				onRuntime: () => () => {},
			};
			window.quakeWallpaper = {
				request: async () => ({
					_tag: "success",
					snapshot: {
						saved: {
							version: 1,
							serial: other,
							revision: 0,
							settings: defaultWallpaper,
							clock: defaultClockTile,
						},
						clock: { epochMillis: 0, hour: 0, minute: 0, second: 0 },
						asset: { _tag: "empty" },
						recovered: false,
						normalizedFileUrl: false,
						deviceDelivery: "unverified",
					},
				}),
				onSnapshot: () => () => {},
				onClock: () => () => {},
				audio: async () => false,
			};
			try {
				await act(async () => root.render(<StripPanel />));
				await flush();
				await act(async () => {
					for (const listener of listeners)
						listener({
							source: "mock",
							kind: "touch",
							points: [{ x: 100, y: 380, action: 1 }],
						});
				});
				await flush();
				expect(
					request.mock.calls
						.filter(([command]) => command.type === "activate")
						.map(([command]) => command),
				).toEqual([
					expect.objectContaining({
						deviceId: serial,
						profileId: `profile-${serial}`,
						kind: "down",
					}),
				]);
				await act(async () => {
					for (const listener of listeners)
						listener({
							source: "mock",
							kind: "resource",
							envelope: {
								opCode: 2,
								metadata: [1, 1, 1, 0, 0],
								sequence: 0,
								payload: [
									255, 216, 255, 192, 0, 11, 8, 0, 1, 0, 1, 1, 1, 17, 0, 255,
									218, 0, 8, 1, 1, 0, 0, 63, 0, 255, 217,
								],
							},
						});
				});
				const image = document.querySelector(
					'[data-key-code="1,1"] img[src^="data:image/jpeg;base64,"]',
				);
				expect(image).not.toBeNull();
				// End the preceding touch contact before exercising legacy matrix state input.
				await act(async () => {
					for (const listener of listeners)
						listener({
							source: "mock",
							kind: "touch",
							points: [{ x: 100, y: 380, action: 0 }],
						});
				});
				await flush();
				request.mockClear();
				const matrix = async (index: number) => {
					await act(async () => {
						for (const listener of listeners)
							listener({
								source: "mock",
								kind: "matrix",
								matrix: {
									reserved: [0, 0, 0, 0],
									states: Array.from({ length: 15 }, (_, i) =>
										i === index ? 1 : 0,
									),
									tail: [],
								},
							});
					});
					await flush();
				};
				await matrix(0);
				await matrix(0);
				await matrix(-1);
				expect(
					request.mock.calls
						.filter(([c]) => c.type === "activate")
						.map(([c]) => c),
				).toEqual([
					expect.objectContaining({
						deviceId: serial,
						profileId: `profile-${serial}`,
						keyCode: "1,1",
						kind: "down",
					}),
					expect.objectContaining({
						deviceId: serial,
						profileId: `profile-${serial}`,
						keyCode: "1,1",
						kind: "up",
					}),
				]);
				await matrix(0);
				await act(async () => {
					for (const listener of listeners)
						listener({
							source: "mock",
							kind: "status",
							state: "disconnected",
							reason: "requested",
						});
				});
				await flush();
				expect(request.mock.calls.at(-1)?.[0]).toMatchObject({
					type: "activate",
					kind: "cancel",
				});
				await matrix(1);
				await matrix(1);
				expect(emojiPress).not.toHaveBeenCalled();
				await matrix(-1);
				expect(emojiPress).toHaveBeenCalledExactlyOnceWith({
					profileId: `profile-${serial}`,
					pageId: "page",
					keyCode: "1,2",
					keyAction: 1,
				});
			} finally {
				await act(async () => root.unmount());
				window.history.replaceState({}, "", "/");
				delete window.quakeWallpaper;
			}
		},
	);
	it("KNOB-014 KNOB-015 renders focus from native taps and restores only its captured generation", async () => {
		const original = fixtureProfile();
		const profile: Profile = {
			...original,
			pages: [
				{
					...original.pages[0],
					keys: [
						...original.pages[0].keys,
						...original.pages[0].keys.map((key) => ({
							...key,
							keyCode: "1,2",
							config: { ...key.config, type: "hotkey", supportKnob: false },
						})),
					],
				},
			],
		};
		const layout = stripLayout(profile, profile.pages[0]);
		const context: KnobModelContext = {
			session: {
				deviceId: "mock-device",
				sessionId: "touch-session",
				profileId: profile.id,
				revision: 0,
			},
			profiles: [
				{
					id: profile.id,
					name: profile.name,
					colorful: false,
					thumbnail: { _tag: "missing" },
				},
			],
			keys: [
				{ keyCode: "1,1", kind: "vol", visible: true, supportKnob: true },
				{ keyCode: "1,2", kind: "hotkey", visible: true, supportKnob: false },
			],
			player: false,
		};
		const runtime = ManagedRuntime.make(
			KnobModel.DefaultWithoutDependencies.pipe(
				Layer.provide(
					Layer.succeed(KnobModelPorts, {
						selectProfile: () => Effect.succeed(context),
						focusedTurn: () => Effect.void,
						voice: () => Effect.void,
						readVolume: Effect.succeed({ level: 40, muted: false }),
						writeVolume: () => Effect.void,
						warmThumbnails: (profiles) => Effect.succeed(profiles),
					}),
				),
			),
		);
		disposals.push(() => runtime.dispose());
		await runtime.runPromise(KnobModel.configure(context));
		let changed: ((snapshot: unknown) => void) | undefined,
			voice: ((value: unknown) => void) | undefined;
		const commands: KnobRequest[] = [];
		window.quakeKnob = {
			onSnapshot: (listener) => {
				changed = listener;
				return () => {
					changed = undefined;
				};
			},
			request: async (command) => {
				commands.push(command);
				if (command._tag !== "Read")
					await runtime.runPromise(KnobModel.dispatch(command));
				const snapshot = await runtime.runPromise(KnobModel.snapshot());
				changed?.(snapshot);
				return { _tag: "success", snapshot };
			},
		};
		window.quakeVoice = {
			request: async () => ({ _tag: "ok" }),
			onEvent: (listener) => {
				voice = listener;
				return () => {
					voice = undefined;
				};
			},
		};
		window.quakeProfiles = {
			read: async () => ({
				_tag: "ready",
				envelope: encodeProfileEnvelope({
					...createInitialProfileEnvelope(),
					profiles: [profile],
				}),
			}),
			onSnapshot: () => () => {},
		};
		const { node, root } = host();
		await act(async () =>
			root.render(
				<svg aria-hidden="true">
					<KnobPanelLayer />
				</svg>,
			),
		);
		await flush();
		const native = input(node, layout),
			tile = layout.tiles[0];
		if (!tile) throw new Error("Missing tile");
		const tap = async () => {
			await act(async () => {
				native.frame(tile.slot.x + 40, tile.slot.y + 40, 1);
				native.frame(tile.slot.x + 40, tile.slot.y + 40, 0);
			});
			await flush();
		};
		await tap();
		expect(
			node.querySelector('.knob-tile-target[aria-pressed="true"] svg'),
		).not.toBeNull();
		const unsupported = layout.tiles[1];
		if (!unsupported) throw new Error("Missing unsupported tile");
		await act(async () => {
			native.frame(unsupported.slot.x + 40, unsupported.slot.y + 40, 1);
			native.frame(unsupported.slot.x + 40, unsupported.slot.y + 40, 0);
		});
		await flush();
		expect(
			node.querySelector('.knob-tile-target[aria-pressed="true"]'),
		).toBeNull();
		await tap();
		await tap();
		expect(
			node.querySelector('.knob-tile-target[aria-pressed="true"]'),
		).toBeNull();
		await tap();
		await act(async () => {
			voice?.({
				_tag: "Stage",
				serial: "mock-device",
				keyCode: "0,1",
				captureId: "capture-1",
				stage: { _tag: "processing" },
			});
		});
		await tap();
		await tap();
		await act(async () => {
			voice?.({
				_tag: "Stage",
				serial: "mock-device",
				keyCode: "0,1",
				captureId: "capture-1",
				stage: { _tag: "idle", outcome: "completed" },
			});
		});
		await flush();
		expect(
			node.querySelector('.knob-tile-target[aria-pressed="true"] svg'),
		).not.toBeNull();
		await act(async () => {
			voice?.({
				_tag: "Stage",
				serial: "mock-device",
				keyCode: "0,1",
				captureId: "capture-2",
				stage: { _tag: "processing" },
			});
			voice?.({
				_tag: "Stage",
				serial: "mock-device",
				keyCode: "0,1",
				captureId: "busy/0,1/1",
				stage: { _tag: "busy" },
			});
			voice?.({
				_tag: "Stage",
				serial: "mock-device",
				keyCode: "0,1",
				captureId: "capture-2",
				stage: { _tag: "idle", outcome: "completed" },
			});
		});
		await flush();
		expect(
			node.querySelector('.knob-tile-target[aria-pressed="true"]'),
		).toBeNull();
		const count = commands.filter((x) => x._tag === "TapTile").length;
		await act(async () => {
			native.frame(tile.slot.x + 40, tile.slot.y + 40, 1);
			native.frame(tile.slot.x + 90, tile.slot.y + 40, 1);
			native.frame(tile.slot.x + 90, tile.slot.y + 40, 0);
		});
		await flush();
		expect(commands.filter((x) => x._tag === "TapTile")).toHaveLength(count);
		await tap();
		await runtime.runPromise(
			KnobModel.configure({
				...context,
				session: { ...context.session, sessionId: "new-session", revision: 1 },
			}),
		);
		changed?.(await runtime.runPromise(KnobModel.snapshot()));
		await flush();
		expect(
			node.querySelector('.knob-tile-target[aria-pressed="true"]'),
		).toBeNull();
	});
	it.each([false, true])(
		"KNOB-075 KNOB-080 capsule handles native, cancel, keyboard and read-only=%s",
		async (readOnly) => {
			const { node, root } = host(),
				toggle = vi.fn(),
				profile = fixtureProfile();
			await act(async () =>
				root.render(
					<VolumeCapsule
						volume={{ phase: "inactive", level: 40, muted: false }}
						toggle={toggle}
						readOnly={readOnly}
					/>,
				),
			);
			const button = node.querySelector("button");
			if (!button) throw new Error("Missing capsule");
			vi.spyOn(button, "getBoundingClientRect").mockReturnValue(
				new DOMRect(50, 50, 120, 60),
			);
			const native = input(node, stripLayout(profile, profile.pages[0]));
			await act(async () => {
				native.frame(100, 80, 1);
				native.frame(100, 80, 0);
				button.click();
			});
			expect(toggle).toHaveBeenCalledTimes(readOnly ? 0 : 1);
			await act(async () => {
				native.frame(100, 80, 1);
				node.dispatchEvent(new Event("quake-strip-reset"));
				native.frame(100, 80, 0);
			});
			expect(toggle).toHaveBeenCalledTimes(readOnly ? 0 : 1);
			await act(async () => {
				button.dispatchEvent(
					new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
				);
				button.dispatchEvent(
					new KeyboardEvent("keydown", { key: " ", bubbles: true }),
				);
			});
			expect(toggle).toHaveBeenCalledTimes(readOnly ? 0 : 3);
			for (const phase of ["activating", "unavailable"] as const) {
				await act(async () =>
					root.render(
						<VolumeCapsule
							volume={{ phase, level: 66, muted: true }}
							toggle={toggle}
						/>,
					),
				);
				await act(async () => {
					native.frame(100, 80, 1);
					native.frame(100, 80, 0);
					button.click();
				});
			}
			expect(toggle).toHaveBeenCalledTimes(readOnly ? 0 : 3);
			expect(button.textContent).toContain("--");
		},
	);
	it.each([
		"audioPlayerViewBackwards",
		"playStop",
		"playStopActive",
		"audioPlayerViewForwards",
	])(
		"KNOB-089 retained transport %s cancels and suppresses duplicate clicks",
		async (id) => {
			const { node, root } = host(),
				press = vi.fn(),
				profile = fixtureProfile();
			await act(async () =>
				root.render(
					<div className="strip-slot" data-state="tile" data-key-code="1,1">
						<TransportButton id={id} label={id} onPress={press}>
							Transport
						</TransportButton>
					</div>,
				),
			);
			const button = node.querySelector("button");
			if (!button) throw new Error("Missing transport");
			vi.spyOn(button, "getBoundingClientRect").mockReturnValue(
				new DOMRect(50, 50, 100, 60),
			);
			const native = input(node, stripLayout(profile, profile.pages[0]));
			await act(async () => {
				native.frame(80, 80, 1);
				native.frame(120, 80, 1);
				native.frame(120, 80, 0);
			});
			expect(press).not.toHaveBeenCalled();
			await act(async () => {
				native.frame(80, 80, 1);
				native.frame(80, 80, 0);
				button.click();
			});
			expect(press).toHaveBeenCalledOnce();
			await act(async () =>
				root.render(
					<div className="strip-slot" data-state="tile" data-key-code="1,1">
						<TransportButton id={id} label={id} disabled onPress={press}>
							Transport
						</TransportButton>
					</div>,
				),
			);
			await act(async () => {
				native.frame(80, 80, 1);
				native.frame(80, 80, 0);
				button.click();
			});
			expect(press).toHaveBeenCalledOnce();
		},
	);
	it.each(["playAudio", "playAudioLegacy"])(
		"KNOB-089 %s local-player controls are exclusive and body taps preserve tile presses",
		async (type) => {
			const { node, root } = host(),
				base = fixtureProfile(),
				original = base.pages[0].keys[0];
			if (!original) throw new Error("Missing key");
			const profile: Profile = {
				...base,
				pages: [
					{
						id: "page",
						compatibility: Option.none(),
						keys: [
							{
								...original,
								config: {
									...original.config,
									type,
									actions: [
										{ type: "sound", value: '["/private/music/a.mp3"]' },
										{ type: "audioAction", value: 0 },
										{ type: "audioFade", value: "0-0" },
										{ type: "volume", value: 50 },
									],
								},
							},
						],
					},
				],
			};
			const layout = stripLayout(profile, profile.pages[0]),
				tile = layout.tiles[0];
			if (!tile) throw new Error("Missing local player");
			const request = vi.fn(
				async (_command: import("../../../shared/key-library").KeyRequest) => ({
					_tag: "success" as const,
				}),
			);
			window.quakeKeyLibrary = {
				request,
				onPreview: () => () => {},
				onRuntime: () => () => {},
			};
			const context = {
				now: undefined,
				hourFormat: "24h" as const,
				voice: previewVoiceContext,
				keyTarget: {
					deviceId: "device",
					profileId: profile.id,
					pageId: "page",
					revision: 0,
				},
			};
			await act(async () =>
				root.render(
					<div className="strip-slot" data-state="tile" data-key-code="1,1">
						<SoundboardUnavailableTile tile={tile} context={context} />
					</div>,
				),
			);
			const keys: StripKeyEvent[] = [];
			const native = input(node, layout, (event) => keys.push(event));
			const controls = Array.from(node.querySelectorAll("button"));
			expect(controls).toHaveLength(4);
			controls.forEach((button, index) => {
				vi.spyOn(button, "getBoundingClientRect").mockReturnValue(
					new DOMRect(20 + index * 45, 100, 35, 60),
				);
			});
			for (let index = 0; index < controls.length; index++) {
				await act(async () => {
					native.frame(30 + index * 45, 120, 1);
					native.frame(30 + index * 45, 120, 0);
					controls[index]?.click();
				});
			}
			expect(request.mock.calls.map(([command]) => command)).toHaveLength(4);
			expect(keys).toEqual([]);
			await act(async () => {
				native.frame(50, 50, 1);
				native.frame(50, 50, 0);
			});
			await flush();
			expect(keys).toEqual([
				{ keyCode: "1,1", keyAction: 0 },
				{ keyCode: "1,1", keyAction: 1, voiceTouchEnd: true },
			]);
			expect(request).toHaveBeenCalledTimes(4);

			await act(async () =>
				root.render(
					<div className="strip-slot" data-state="tile" data-key-code="1,1">
						<SoundboardUnavailableTile
							tile={tile}
							context={{ ...context, interactive: false }}
						/>
					</div>,
				),
			);
			await act(async () => {
				native.frame(30, 120, 1);
				native.frame(30, 120, 0);
				controls[0]?.click();
			});
			expect(request).toHaveBeenCalledTimes(4);
		},
	);
	it("ClawBot text-entry touch targets preserve Space and Enter without losing touch focus", async () => {
		const { root, node } = host();
		const base = fixtureProfile();
		const layout = stripLayout(base, base.pages[0]);
		const tile = layout.tiles[0];
		if (!tile) throw new Error("Missing input tile");
		const request = vi.fn(async () => ({ _tag: "ok" as const }));
		await act(async () =>
			root.render(
				<ClawBotInputTile
					tile={tile}
					context={{
						now: undefined,
						hourFormat: "24h",
						voice: { ...previewVoiceContext, surface: "panel", request },
					}}
				/>,
			),
		);
		const textarea = node.querySelector("textarea");
		if (!textarea) throw new Error("Missing textarea");
		for (const key of [" ", "Enter"]) {
			const event = new KeyboardEvent("keydown", {
				key,
				bubbles: true,
				cancelable: true,
			});
			textarea.dispatchEvent(event);
			expect(event.defaultPrevented).toBe(false);
		}
		expect(request).not.toHaveBeenCalled();
		await act(async () => {
			textarea.dispatchEvent(
				new CustomEvent("quake-sub-touch-start", {
					detail: { phase: "start" },
				}),
			);
			textarea.dispatchEvent(
				new CustomEvent("quake-sub-touch-end", {
					detail: { confirmedTap: true },
				}),
			);
		});
		expect(request).toHaveBeenCalledWith({ _tag: "FocusPanel" });
	});
	it("ClawBot pointer taps and drags preserve native caret and selection defaults", async () => {
		const { root, node } = host();
		const base = fixtureProfile();
		const layout = stripLayout(base, base.pages[0]);
		const tile = layout.tiles[0];
		if (!tile) throw new Error("Missing input tile");
		const request = vi.fn(async () => ({ _tag: "ok" as const }));
		await act(async () =>
			root.render(
				<div className="strip-slot" data-state="tile" data-key-code="1,1">
					<ClawBotInputTile
						tile={tile}
						context={{
							now: undefined,
							hourFormat: "24h",
							voice: { ...previewVoiceContext, surface: "panel", request },
						}}
					/>
				</div>,
			),
		);
		const textarea = node.querySelector("textarea");
		if (!textarea) throw new Error("Missing textarea");
		vi.spyOn(textarea, "getBoundingClientRect").mockReturnValue(
			new DOMRect(30, 30, 180, 180),
		);
		input(node, layout);
		const pointer = async (type: string, x = 100) => {
			const event = new PointerEvent(type, {
				pointerId: 1,
				button: 0,
				clientX: x,
				clientY: 100,
				bubbles: true,
				cancelable: true,
			});
			await act(async () => {
				textarea.dispatchEvent(event);
			});
			expect(event.defaultPrevented).toBe(false);
		};
		await pointer("pointerdown");
		await pointer("pointerup");
		const click = new MouseEvent("click", { bubbles: true, cancelable: true });
		textarea.dispatchEvent(click);
		expect(click.defaultPrevented).toBe(false);
		expect(request).toHaveBeenCalledTimes(1);
		expect(request).toHaveBeenLastCalledWith({ _tag: "FocusPanel" });
		await pointer("pointerdown");
		await pointer("pointermove", 150);
		await pointer("pointerup", 150);
		expect(request).toHaveBeenCalledTimes(1);
	});
	it("Copilot binds conditional copy buttons across appearance, repaint and recreation", async () => {
		const { root, node } = host();
		const base = fixtureProfile();
		const tile = stripLayout(base, base.pages[0]).tiles[0];
		if (!tile) throw new Error("Missing copilot tile");
		const request = vi.fn(async () => ({ _tag: "ok" as const }));
		const render = async (text: string) =>
			act(async () =>
				root.render(
					<AiCopilotTile
						tile={tile}
						context={{
							now: undefined,
							hourFormat: "24h",
							voice: {
								...previewVoiceContext,
								surface: "panel",
								request,
								view: {
									...previewVoiceContext.view,
									copilot: { ...previewVoiceContext.view.copilot, text },
								},
							},
						}}
					/>,
				),
			);
		const start = (button: HTMLElement) =>
			button.dispatchEvent(
				new CustomEvent("quake-sub-touch-start", {
					detail: { phase: "start" },
				}),
			);
		const end = (button: HTMLElement) =>
			button.dispatchEvent(
				new CustomEvent("quake-sub-touch-end", {
					detail: { confirmedTap: true },
				}),
			);
		await render("");
		expect(node.querySelector(".copilot-copy")).toBeNull();
		await render("first transcript");
		const button = node.querySelector<HTMLButtonElement>(".copilot-copy");
		if (!button) throw new Error("Missing copy button");
		await act(async () => {
			start(button);
			end(button);
		});
		expect(request).toHaveBeenLastCalledWith({
			_tag: "CopyText",
			text: "first transcript",
		});
		start(button);
		await render("updated transcript");
		await act(async () => {
			end(button);
		});
		expect(request).toHaveBeenLastCalledWith({
			_tag: "CopyText",
			text: "updated transcript",
		});
		await render("");
		start(button);
		end(button);
		expect(request).toHaveBeenCalledTimes(2);
		await render("second transcript");
		const next = node.querySelector<HTMLButtonElement>(".copilot-copy");
		if (!next) throw new Error("Missing recreated button");
		await act(async () => {
			start(next);
			end(next);
			next.click();
		});
		expect(request).toHaveBeenCalledTimes(3);
		expect(request).toHaveBeenLastCalledWith({
			_tag: "CopyText",
			text: "second transcript",
		});
	});
	it("SCREEN-010 cancels held keys after same-page content replacement but preserves runtime repaint ownership", async () => {
		const { node, root } = host();
		const base = fixtureProfile();
		const profile: Profile = {
			...base,
			pages: [
				{
					...base.pages[0],
					keys: base.pages[0].keys.map((key) => ({
						...key,
						config: {
							...key.config,
							type: "hotkeySwitch",
							actions: [{ type: "hotkey", value: "control+a" }],
						},
					})),
				},
			],
		};
		const events = new Set<(event: QuakeEvent) => void>();
		let snapshot: ((value: unknown) => void) | undefined;
		let runtime: ((state: KeyRuntimeState) => void) | undefined;
		const envelope: ProfileEnvelope = {
			...createInitialProfileEnvelope(),
			profiles: [profile],
		};
		const request = vi.fn(async (_command: KeyRequest) => ({
			_tag: "success" as const,
		}));
		window.openQuake = {
			version: "test",
			onQuakeEvent: (listener) => {
				events.add(listener);
				return () => {
					events.delete(listener);
				};
			},
		};
		window.quakeProfiles = {
			read: async () => ({
				_tag: "ready",
				envelope: encodeProfileEnvelope(envelope),
			}),
			onSnapshot: (listener) => {
				snapshot = listener;
				return () => {};
			},
		};
		window.quakeKeyLibrary = {
			request,
			onPreview: () => () => {},
			onRuntime: (listener) => {
				runtime = listener;
				return () => {};
			},
		};
		await act(async () => root.render(<StripPanel />));
		await flush();
		const reset = vi.fn();
		node.addEventListener("quake-strip-reset", reset);
		const frame = (action: 0 | 1) => {
			for (const listener of events)
				listener({
					source: "mock",
					kind: "touch",
					points: [{ x: 100, y: 380, action }],
				});
		};
		await act(async () => frame(1));
		expect(
			request.mock.calls
				.filter(([command]) => command.type === "activate")
				.map(([command]) => command),
		).toEqual([
			expect.objectContaining({ kind: "down", revision: profile.revision }),
		]);
		await act(async () =>
			runtime?.({
				deviceId: "desktop-preview",
				profileId: profile.id,
				pageId: "page",
				keyCode: "1,1",
				alternate: 1,
			}),
		);
		expect(reset).not.toHaveBeenCalled();
		const changed: Profile = {
			...profile,
			revision: profile.revision + 1,
			pages: [
				{
					...profile.pages[0],
					keys: profile.pages[0].keys.map((key) => ({
						...key,
						config: {
							...key.config,
							actions: [{ type: "hotkey", value: "control+b" }],
						},
					})),
				},
			],
		};
		await act(async () =>
			snapshot?.({
				_tag: "ready",
				envelope: encodeProfileEnvelope({ ...envelope, profiles: [changed] }),
			}),
		);
		await flush();
		expect(reset).toHaveBeenCalledOnce();
		expect(
			request.mock.calls
				.filter(([command]) => command.type === "activate")
				.map(([command]) => command),
		).toEqual([
			expect.objectContaining({ kind: "down", revision: profile.revision }),
			expect.objectContaining({ kind: "cancel", revision: profile.revision }),
		]);
		await act(async () => frame(1));
		expect(
			request.mock.calls.filter(([command]) => command.type === "activate"),
		).toHaveLength(2);
		await act(async () => frame(0));
		await act(async () => frame(1));
		expect(request.mock.calls.at(-1)?.[0]).toEqual(
			expect.objectContaining({
				type: "activate",
				kind: "down",
				revision: changed.revision,
			}),
		);
		delete window.openQuake;
	});
	it("SCREEN-010 pagehide unmounts the whole production panel and releases active subscriptions and timers", async () => {
		vi.useFakeTimers();
		const { node, root } = host(),
			profile = fixtureProfile(),
			events = new Set<(event: QuakeEvent) => void>(),
			voices = new Set<(event: unknown) => void>();
		const offProfiles = vi.fn(),
			offKnob = vi.fn();
		window.openQuake = {
			version: "test",
			onQuakeEvent: (listener) => {
				events.add(listener);
				return () => {
					events.delete(listener);
				};
			},
		};
		window.quakeProfiles = {
			read: async () => ({
				_tag: "ready",
				envelope: encodeProfileEnvelope({
					...createInitialProfileEnvelope(),
					profiles: [profile],
				}),
			}),
			onSnapshot: () => offProfiles,
		};
		window.quakeKnob = {
			request: async () => ({
				_tag: "failure",
				code: "QUAKE.KNOB.CONFIG_INVALID",
			}),
			onSnapshot: () => offKnob,
		};
		window.quakeVoice = {
			request: async () => ({ _tag: "ok" }),
			onEvent: (listener) => {
				voices.add(listener);
				return () => {
					voices.delete(listener);
				};
			},
		};
		window.quakeKeyLibrary = {
			request: async () => ({ _tag: "success" }),
			onPreview: () => () => {},
			onRuntime: () => () => {},
		};
		await act(async () => root.render(<StripPanel />));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(32);
		});
		expect(node.querySelector(".strip-panel")).not.toBeNull();
		expect(events.size).toBeGreaterThan(0);
		await act(async () => {
			for (const listener of events)
				listener({
					source: "mock",
					kind: "touch",
					points: [{ x: 100, y: 380, action: 1 }],
				});
			for (const listener of voices)
				listener({
					_tag: "Stage",
					serial: "device",
					keyCode: "0,1",
					captureId: "capture",
					stage: { _tag: "failed", reason: "noMic" },
				});
		});
		await act(async () => window.dispatchEvent(new Event("pagehide")));
		expect(node.childElementCount).toBe(0);
		expect(events.size).toBe(0);
		expect(voices.size).toBe(0);
		expect(offProfiles).toHaveBeenCalled();
		expect(offKnob).toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
		await vi.advanceTimersByTimeAsync(60000);
		expect(node.childElementCount).toBe(0);
		delete window.openQuake;
		vi.useRealTimers();
	});

	it.each([false, true])(
		"SCREEN-141 mirror lock=%s suppresses pressed effects while leaving the tile inspectable",
		async (locked) => {
			const { root, node } = host(),
				base = fixtureProfile(),
				original = base.pages[0].keys[0];
			if (!original) throw new Error("Missing key");
			const profile: Profile = {
				...base,
				pages: [
					{
						id: "page",
						compatibility: Option.none(),
						keys: [
							{
								...original,
								config: {
									...original.config,
									basicEditableItems: Option.some({
										allowDrag: !locked,
										allowDelete: true,
										title: true,
										grid: true,
										icon: true,
									}),
								},
							},
						],
					},
				],
			};
			const profiles = {
				_tag: "ready" as const,
				envelope: {
					...createInitialProfileEnvelope(),
					profiles: [profile] as const,
				},
			};
			await act(async () =>
				root.render(
					<StripScreen
						profiles={profiles}
						showEmptyGridDashedBorder={false}
						interactive={false}
						pressedKeyCode="1,1"
					/>,
				),
			);
			const tile = node.querySelector<HTMLElement>(
				'[data-state="tile"][data-key-code="1,1"]',
			);
			if (!tile) throw new Error("Missing mirror tile");
			expect(tile.dataset.editLocked === "true").toBe(locked);
			expect(tile.dataset.pressed === "true").toBe(!locked);
			const drag = new Event("dragstart", { bubbles: true, cancelable: true });
			tile.dispatchEvent(drag);
			expect(drag.defaultPrevented).toBe(true);
			expect(tile.textContent).not.toBeNull();
		},
	);
});
