// @vitest-environment happy-dom

import { Option, Schema } from "effect";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { createActionDraft } from "../../../../../../packages/device/src/actions/action-registry";
import {
	defaultHardwarePreferences,
	type HardwareSnapshot,
} from "../../../../../../packages/device/src/hardware/hardware-contracts";
import { builtinProfiles } from "../../../../../../packages/device/src/profiles/profile-catalog";
import { ProfileJsonObject } from "../../../../../../packages/device/src/profiles/profile-contracts";
import { SelectedKeyPreview } from "../keys/SelectedKeyPreview";
import { SequenceEditor } from "../keys/SequenceEditor";
import { stripLayout } from "../strip/geometry";
import { previewVoiceContext } from "../strip/overlays/voice/voice-context";
import { StripScreen } from "../strip/StripScreen";
import { stripTileFor } from "../strip/tileRegistry";
import { HardwareSettings } from "./HardwareSettings";
import { hardwareKeyState } from "./key-state";
import { useHardwareSnapshot } from "./useHardwareSnapshot";

const state = (
	serial = "A",
	patch: Partial<HardwareSnapshot> = {},
): HardwareSnapshot => ({
	serial,
	session: `${serial}-1`,
	available: true,
	preferenceStatus: "saved",
	preferences: defaultHardwarePreferences,
	inputMode: "device",
	...patch,
});
const context = {
	now: undefined,
	hourFormat: "24h" as const,
	voice: previewVoiceContext,
};
const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
afterEach(async () => {
	await act(async () => root.render(null));
	vi.useRealTimers();
	vi.clearAllMocks();
});
function Views({ serial }: { serial: string }) {
	const snapshot = useHardwareSnapshot(serial);
	return (
		<>
			{[
				{ id: "mic-1", type: "mic" },
				{ id: "mic-2", type: "mic" },
				{ id: "b", type: "buzzer" },
				{ id: "l", type: "luminance" },
				{ id: "g", type: "gameMode" },
			].map(({ id, type }) => (
				<output key={id} data-type={type}>
					{JSON.stringify(hardwareKeyState(type, snapshot))}
				</output>
			))}
		</>
	);
}
it("SCREEN-037/150 hydrates every control, clears unknown/rejected replies and ignores old serial replies", async () => {
	vi.useFakeTimers();
	let reply: unknown = { _tag: "ready", snapshot: state("A"), mock: true };
	let late: ((value: unknown) => void) | undefined;
	const request = vi.fn(async () => reply);
	Object.defineProperty(window, "quakeHardware", {
		configurable: true,
		value: { request },
	});
	await act(async () => root.render(<Views serial="A" />));
	expect(host.querySelector('[data-type="mic"]')?.textContent).toBe(
		'{"known":false}',
	);
	expect(host.querySelector('[data-type="buzzer"]')?.textContent).toContain(
		'"alternate":0',
	);
	reply = {
		_tag: "ready",
		snapshot: state("A", { mic: false, luminance: 255 }),
		mock: true,
	};
	await act(async () => vi.advanceTimersByTimeAsync(500));
	for (const element of host.querySelectorAll('[data-type="mic"]'))
		expect(element.textContent).toContain('"alternate":1');
	expect(host.querySelector('[data-type="luminance"]')?.textContent).toContain(
		'"progress":100',
	);
	reply = { _tag: "failure", code: "QUAKE.HARDWARE.COMMAND_REJECTED" };
	await act(async () => vi.advanceTimersByTimeAsync(500));
	expect(host.querySelector('[data-type="mic"]')?.textContent).toBe(
		'{"known":false}',
	);
	request.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				late = resolve;
			}),
	);
	await act(async () => vi.advanceTimersByTimeAsync(500));
	reply = { _tag: "ready", snapshot: state("B", { mic: true }), mock: true };
	await act(async () => root.render(<Views serial="B" />));
	await act(async () =>
		late?.({ _tag: "ready", snapshot: state("A", { mic: false }), mock: true }),
	);
	for (const element of host.querySelectorAll('[data-type="mic"]'))
		expect(element.textContent).toContain('"alternate":0');
	reply = {
		_tag: "ready",
		snapshot: state("B", { session: "B-2", mic: false, inputMode: "host" }),
		mock: true,
	};
	await act(async () => vi.advanceTimersByTimeAsync(500));
	expect(host.querySelector('[data-type="gameMode"]')?.textContent).toContain(
		'"alternate":1',
	);
});
it("MGMT-355 exact game preset has a 4x2 footprint, seven covered cells and platform locks", () => {
	for (const platform of ["linux", "darwin", "win32"] as const) {
		const profiles = builtinProfiles(platform);
		const profile = profiles.find((p) => p.id === "1-0");
		if (!profile) throw new Error("Missing preset");
		const layout = stripLayout(profile, profile.pages[0]);
		const game = layout.tiles.find((t) => t.type === "gameMode");
		expect(game?.footprint).toMatchObject({
			row: 1,
			column: 1,
			width: 4,
			height: 2,
		});
		expect(layout.tiles.filter((t) => t.footprint.column <= 4)).toHaveLength(1);
		const quick = profiles.find((p) => p.id === "1-2");
		for (const type of ["luminance", "buzzer", "mic"]) {
			const key = quick?.pages[0]?.keys.find((k) => k.config.type === type);
			expect(key).toBeDefined();
			if (platform !== "linux")
				expect(
					Option.getOrUndefined(key?.config.basicEditableItems ?? Option.none())
						?.grid,
				).toBe(false);
		}
	}
});
it("WIDGETS-016 registered game consumers share monitoring, replace artwork and stop when owners unmount", async () => {
	let receive: ((value: unknown) => void) | undefined;
	const off = vi.fn();
	const request = vi.fn(async (command: { _tag: string; active?: boolean }) =>
		command._tag === "artwork"
			? { _tag: "foregroundArtwork", artwork: "data:image/png;base64,AAAA" }
			: { _tag: "failure", code: "unavailable" },
	);
	Object.defineProperty(window, "quakeMonitor", {
		configurable: true,
		value: {
			request,
			onSettings: () => () => {},
			onMetrics: () => () => {},
			onArtwork: (cb: (value: unknown) => void) => {
				receive = cb;
				return off;
			},
		},
	});
	const profile = builtinProfiles("linux").find((p) => p.id === "1-0");
	if (!profile) throw new Error("Missing preset");
	const raw = stripLayout(profile, profile.pages[0]).tiles.find(
		(t) => t.type === "gameMode",
	);
	if (!raw) throw new Error("Missing game");
	const tile = {
		...raw,
		key: {
			...raw.key,
			config: {
				...raw.key.config,
				actions: [{ type: "monitorAppView", value: true }],
			},
		},
	};
	const Game = stripTileFor("gameMode");
	await act(async () =>
		root.render(
			<>
				<Game tile={tile} context={{ ...context, hardware: state() }} />
				<Game tile={tile} context={{ ...context, hardware: state() }} />
			</>,
		),
	);
	expect(
		request.mock.calls.filter(([c]) => c._tag === "watch" && c.active),
	).toHaveLength(1);
	await act(async () =>
		receive?.({
			_tag: "foregroundArtwork",
			artwork: "data:image/png;base64,BBBB",
		}),
	);
	expect(
		host.querySelector('img[src="data:image/png;base64,BBBB"]'),
	).not.toBeNull();
	await act(async () =>
		root.render(
			<Game
				tile={tile}
				context={{ ...context, hardware: state("A", { inputMode: "host" }) }}
			/>,
		),
	);
	expect(host.querySelector("img")).toBeNull();
	expect(host.textContent).toContain("Normal");
	expect(
		request.mock.calls.filter(
			([c]) => c._tag === "watch" && c.active === false,
		),
	).toHaveLength(1);
	expect(off).toHaveBeenCalled();
});
it("SETTINGS-082 long tone stops on blur and settings unmount", async () => {
	const request = vi.fn(async (command: { _tag: string }) =>
		command._tag === "qmkTargets"
			? { _tag: "qmkTargets", targets: [] }
			: { _tag: "ready", snapshot: state(), mock: true },
	);
	Object.defineProperty(window, "quakeHardware", {
		configurable: true,
		value: { request },
	});
	await act(async () => root.render(<HardwareSettings />));
	const button = Array.from(host.querySelectorAll("button")).find(
		(b) => b.textContent === "Hold to test buzzer",
	);
	if (!button) throw new Error("Missing tone");
	await act(async () =>
		button.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		),
	);
	expect(request).toHaveBeenCalledWith({
		_tag: "longTone",
		session: "A-1",
		on: true,
	});
	await act(async () =>
		button.dispatchEvent(new FocusEvent("focusout", { bubbles: true })),
	);
	expect(request).toHaveBeenCalledWith({
		_tag: "longTone",
		session: "A-1",
		on: false,
	});
	request.mockClear();
	await act(async () => root.render(null));
	expect(request).toHaveBeenCalledWith({
		_tag: "longTone",
		session: "A-1",
		on: false,
	});
});
it("MGMT-205 toggle steps preserve their numeric tuples and HA configuration is reachable", async () => {
	const value = Schema.decodeUnknownSync(Schema.Array(ProfileJsonObject))([
		{ editorId: "b", config: createActionDraft("buzzer") },
		{ editorId: "h", config: createActionDraft("homeAssistant") },
	]);
	const change = vi.fn();
	await act(async () =>
		root.render(<SequenceEditor value={value} onChange={change} />),
	);
	expect(
		host
			.querySelectorAll(".key-sequence-step")[0]
			?.querySelectorAll('input[type="text"]'),
	).toHaveLength(0);
	const option = Array.from(host.querySelectorAll("option")).find(
		(option) => option.textContent === "homeAssistant",
	);
	expect(option?.disabled).toBe(false);
	expect(host.textContent).toContain("Home Assistant configuration (JSON)");
});

it("MGMT-363 MeetAI mic uses its serial hardware state and saved activation instead of global meeting mic", async () => {
	const { meetingTile } = await import("../meetings/meeting-test-fixture");
	const props = meetingTile("mic");
	const Mic = stripTileFor("mic");
	const request = vi.fn(async () => ({ _tag: "success" }));
	Object.defineProperty(window, "quakeKeyLibrary", {
		configurable: true,
		value: { request },
	});
	const target = { deviceId: "A", profileId: "p", pageId: "1", revision: 0 };
	await act(async () =>
		root.render(
			<Mic
				{...props}
				context={{
					...props.context,
					hardware: state("A", { mic: false }),
					keyTarget: target,
				}}
			/>,
		),
	);
	expect(
		host.querySelector('svg use[href*="mute"]') ??
			host.querySelector('[data-active="false"]'),
	).not.toBeNull();
	await act(async () =>
		host.querySelector<HTMLButtonElement>("button")?.click(),
	);
	expect(request).toHaveBeenCalledWith({
		...target,
		type: "activate",
		keyCode: props.tile.keyCode,
		kind: "press",
	});
	await act(async () =>
		root.render(
			<Mic
				{...props}
				context={{ ...props.context, hardware: state("A"), keyTarget: target }}
			/>,
		),
	);
	expect(host.querySelector<HTMLButtonElement>("button")?.disabled).toBe(true);
});

it("shows the selected QUAKE brightness in both inert Studio previews and drops stale device values", async () => {
	vi.useFakeTimers();
	vi.stubGlobal("quakeKeyLibrary", {
		onRuntime: () => () => {},
		request: async () => ({ _tag: "success", states: [] }),
	});
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			disconnect() {}
		},
	);
	let live = state("A", { luminance: 255 });
	const request = vi.fn(async () => ({
		_tag: "ready",
		snapshot: live,
		mock: true,
	}));
	Object.defineProperty(window, "quakeHardware", {
		configurable: true,
		value: { request },
	});
	const profile = builtinProfiles("darwin").find((p) => p.id === "1-2");
	if (!profile) throw Error("Quick missing");
	const tile = stripLayout(profile, profile.pages[0]).tiles.find(
		(t) => t.type === "luminance",
	);
	if (!tile) throw Error("Brightness missing");
	const previews = (serial: string, previewProfile = profile) => (
		<>
			<div data-grid>
				<StripScreen
					previewSerial="editor-preview"
					hardwareSerial={serial}
					interactive={false}
					profiles={{
						_tag: "ready",
						envelope: {
							schemaVersion: 1,
							profiles: [previewProfile],
							activeByDevice: {
								"editor-preview": {
									profileId: profile.id,
									pageId: profile.pages[0].id,
								},
							},
							manager: Option.none(),
						},
					}}
					showEmptyGridDashedBorder={false}
				/>
			</div>
			<SelectedKeyPreview
				tile={tile}
				serial={serial}
				target={{
					profileId: profile.id,
					pageId: profile.pages[0].id,
					keyCode: tile.keyCode,
				}}
				beforeWrite={async () => true}
				onSaved={async () => {}}
				isCurrent={() => true}
			/>
		</>
	);
	await act(async () => root.render(previews("A")));
	expect(request).toHaveBeenCalledWith({ _tag: "read", serial: "A" });
	expect(request).not.toHaveBeenCalledWith({
		_tag: "read",
		serial: "editor-preview",
	});
	expect(
		host.querySelector('[data-grid] [data-type="luminance"]')?.textContent,
	).toContain("100%");
	expect(host.querySelector(".key-selected-preview")?.textContent).toContain(
		"100%",
	);
	await act(async () => root.render(previews("desktop-preview")));
	expect(request).toHaveBeenCalledWith({ _tag: "read" });
	expect(request).not.toHaveBeenCalledWith({
		_tag: "read",
		serial: "desktop-preview",
	});
	expect(
		host.querySelector('[data-grid] [data-type="luminance"]')?.textContent,
	).toContain("100%");

	live = state("B", { luminance: 128 });
	await act(async () => root.render(previews("B")));
	expect(host.querySelector(".key-selected-preview")?.textContent).toContain(
		"50%",
	);
	expect(
		host.querySelector('[data-grid] [data-type="luminance"]')?.textContent,
	).toContain("50%");
	const customProfile = {
		...profile,
		pages: [
			{
				...profile.pages[0],
				keys: profile.pages[0].keys.map((key) =>
					key.config.type === "luminance"
						? {
								...key,
								config: {
									...key.config,
									title: { ...key.config.title, userModifiedStyle: true },
								},
							}
						: key,
				),
			},
		] as typeof profile.pages,
	};
	await act(async () => root.render(previews("B", customProfile)));
	expect(
		host
			.querySelector('[data-grid] [role="progressbar"]')
			?.getAttribute("aria-valuenow"),
	).toBe("50");
	live = state("B", { luminance: 128, available: false });
	await act(async () => vi.advanceTimersByTimeAsync(500));
	expect(
		host.querySelector(".key-selected-preview")?.textContent,
	).not.toContain("50%");
	expect(
		host.querySelector('[data-grid] [data-type="luminance"]')?.textContent,
	).not.toContain("50%");
	vi.unstubAllGlobals();
});
