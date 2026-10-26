// @vitest-environment happy-dom
import { Option, Schema } from "effect";
import { act, createElement, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
	createEmptyProfileKey,
	ProfileKey,
} from "../../../../../../packages/device/src/profiles/profile-contracts";
import { mediaSession } from "../../../main/weather-media/test-fixtures";
import {
	DEFAULT_WEATHER_SETTINGS,
	type LocalPlayerSnapshot,
	type WeatherMediaSnapshot,
} from "../../../shared/weather-media-contracts";
import { button, click, input, mount, query } from "../../test/dom";
import { stripLayout } from "../strip/geometry";
import { previewVoiceContext } from "../strip/overlays/voice/voice-context";
import { stripTileFor } from "../strip/tileRegistry";
import {
	AudioOperationPicker,
	MediaKeySettings,
	SystemMediaSettings,
} from "./MediaKeySettings";
import { PlayerCard } from "./PlayerCard";

const fake = vi.hoisted(() => ({
	snapshot: { revision: 1, settings: {}, media: {} } as unknown,
	client: {
		request: vi.fn(),
		configure: vi.fn(),
		refresh: vi.fn(),
		control: vi.fn(),
	},
}));
vi.mock("./hooks", () => ({
	useWeatherLocale: () => "en",
	useWeatherMedia: () => fake,
}));
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const close of cleanups.splice(0)) await close();
	vi.useRealTimers();
	vi.clearAllMocks();
});
async function mounted(node: React.ReactNode) {
	const view = await mount(node);
	cleanups.push(view.close);
	return view;
}

it("KNOB-095 WIDGETS-114 resets broken cover artwork when the next track arrives", async () => {
	const control = vi.fn(async () => true);
	const cover = "data:image/png;base64,YQ==";
	let state = {
		revision: 1,
		session: { ...mediaSession, coverUrl: cover },
		error: null,
	};
	let update = (_next: typeof state) => {};
	function View() {
		const [value, setValue] = useState(state);
		update = setValue;
		return (
			<PlayerCard
				widthPx={960}
				heightPx={240}
				snapshot={value}
				control={control}
			/>
		);
	}
	const view = await mounted(<View />);
	await act(async () =>
		query(view.host, ".oq-player-cover img", HTMLImageElement).dispatchEvent(
			new Event("error"),
		),
	);
	expect(view.host.querySelector(".oq-player-cover img")).toBeNull();
	expect(view.host.querySelector(".oq-player-cover svg")).not.toBeNull();
	// A new identity can reuse the same URL and must still retry artwork.
	state = {
		...state,
		revision: 2,
		session: { ...state.session, title: "Next track" },
	};
	await act(async () => update(state));
	expect(query(view.host, ".oq-player-cover img", HTMLImageElement).src).toBe(
		cover,
	);
	expect(view.host.textContent).toContain("Next track");
});
it.each(["en", "de"] as const)(
	"WIDGETS-117 retained errors disable transport and show localized status in %s",
	async (locale) => {
		const messages: string[] = [];
		for (const error of [
			"TCC_DENIED",
			"MEDIAREMOTE_UNAVAILABLE",
			"SMTC_UNAVAILABLE",
			"TRANSPORT_ERROR",
			"SESSION_LOST",
			"UNSUPPORTED_PLATFORM",
		] as const) {
			const view = await mount(
				<PlayerCard
					widthPx={960}
					heightPx={240}
					snapshot={{ revision: 1, session: null, error }}
					control={async () => true}
					locale={locale}
				/>,
			);
			messages.push(
				query(view.host, "[role=status]", HTMLElement).textContent ?? "",
			);
			expect(
				query(view.host, "[data-testid=playStop]", HTMLButtonElement).disabled,
			).toBe(true);
			await view.close();
		}
		expect(messages.every((s) => s.length > 0)).toBe(true);
		expect(new Set(messages).size).toBeGreaterThan(2);
	},
);
it.each([
	["local", "open-quake.local", "Local Music"],
	["system", "org.chrome", "Browser"],
	["system", "org.music", "Music"],
	["system", "", "System Media"],
] as const)(
	"KNOB-097 WIDGETS-112 %s source %s is read-only",
	async (source, appId, label) => {
		const control = vi.fn(async () => true),
			session = appId ? { ...mediaSession, appId, appName: label } : null;
		const view = await mounted(
			<PlayerCard
				widthPx={960}
				heightPx={240}
				snapshot={{ revision: 1, session, error: null }}
				control={control}
				source={source}
			/>,
		);
		const indicator = query(view.host, ".oq-player-source", HTMLDivElement);
		expect(indicator.textContent).toBe(label);
		await click(indicator);
		expect(control).not.toHaveBeenCalled();
		expect(indicator.dataset.kind).toBe(
			source === "local"
				? "local"
				: appId.includes("chrome")
					? "browser"
					: "app",
		);
	},
);
it("MGMT-271 mounted session selection, Follow Current and launcher failures use persisted settings", async () => {
	const snapshot: WeatherMediaSnapshot = {
		revision: 1,
		settings: { ...DEFAULT_WEATHER_SETTINGS, mediaTarget: "b" },
		media: {
			revision: 1,
			session: mediaSession,
			sessions: [mediaSession, { ...mediaSession, id: "b", appName: "Second" }],
			error: null,
		},
	};
	fake.snapshot = snapshot;
	fake.client.configure.mockResolvedValue(true);
	fake.client.request.mockResolvedValue({ _tag: "launched", accepted: false });
	const view = await mounted(<SystemMediaSettings />);
	const selects = view.host.querySelectorAll("select");
	if (!selects[0]) throw new Error("missing sessions");
	await input(selects[0], "");
	expect(fake.client.configure).toHaveBeenCalledWith({ mediaTarget: null });
	await click(button(view.host, "Open"));
	expect(fake.client.request).toHaveBeenCalledWith({
		_tag: "launch",
		id: "apple",
	});
	expect(view.host.textContent).toContain("Media request failed");
});
it("MGMT-226 MGMT-290 mounted twelve-option selectors and per-key source edits preserve other key settings", async () => {
	const change = vi.fn();
	const picker = await mounted(
		<AudioOperationPicker value="audio_play" onChange={change} />,
	);
	const select = query(picker.host, "select", HTMLSelectElement);
	expect(select.options).toHaveLength(12);
	await input(select, "audio_pause");
	expect(change).toHaveBeenCalledWith("audio_pause");
	const empty = createEmptyProfileKey("1,1"),
		key = {
			...empty,
			config: {
				...empty.config,
				type: "playAudio",
				actions: [
					{ type: "sound", value: "/private/music/a.mp3" },
					{ type: "audioAction", value: 0 },
				],
			},
		};
	const edit = vi.fn();
	const settings = await mounted(
		<MediaKeySettings keyValue={key} locale="en" onChange={edit} />,
	);
	await input(query(settings.host, "select", HTMLSelectElement), "system");
	expect(edit.mock.calls[0]?.[0].config.actions).toEqual([
		...key.config.actions,
		{ type: "musicSource", value: "system" },
	]);
});
it("KNOB-092 KNOB-096 WIDGETS-111/113 registered local player uses scoped authoritative state and suppresses overlapping navigation", async () => {
	let snapshot: LocalPlayerSnapshot = {
		revision: 1,
		state: "playing",
		title: "a.mp3",
		trackIndex: 0,
		total: 2,
		positionMs: 100,
		errorCode: null,
	};
	fake.client.request.mockImplementation(async () => ({
		_tag: "localPlayer",
		snapshot,
	}));
	let release: (() => void) | undefined;
	const request = vi.fn(async () => {
		await new Promise<void>((resolve) => {
			release = resolve;
		});
		snapshot = { ...snapshot, revision: 2, title: "b.mp3", trackIndex: 1 };
		return { _tag: "success" as const };
	});
	window.quakeKeyLibrary = {
		request,
		onPreview: () => () => {},
		onRuntime: () => () => {},
	};
	const raw = Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1"));
	const key = Schema.decodeUnknownSync(ProfileKey)({
		...raw,
		childrenName: "playAudio",
		config: {
			...raw.config,
			type: "playAudio",
			size: [5, 2],
			actions: [
				{ type: "sound", value: "a.mp3" },
				{ type: "audioAction", value: 0 },
				{ type: "musicSource", value: "local" },
			],
		},
	});
	const profile = {
		id: "p",
		name: "P",
		compatibility: Option.none(),
		revision: 1,
		pages: [{ id: "one", keys: [key] }],
	};
	const tile = stripLayout(profile, { keys: [key] }).tiles[0];
	if (!tile) throw new Error("missing tile");
	const context = {
		now: undefined,
		hourFormat: "24h" as const,
		voice: previewVoiceContext,
		keyTarget: { deviceId: "d", profileId: "p", pageId: "one", revision: 1 },
	};
	const view = await mounted(
		createElement(stripTileFor("playAudio"), { tile, context }),
	);
	expect(view.host.textContent).toContain("a.mp3");
	await click(
		query(
			view.host,
			"[data-testid=audioPlayerViewForwards]",
			HTMLButtonElement,
		),
	);
	await click(
		query(
			view.host,
			"[data-testid=audioPlayerViewForwards]",
			HTMLButtonElement,
		),
	);
	expect(request).toHaveBeenCalledTimes(1);
	expect(request.mock.calls[0]).toEqual([
		{
			type: "player-control",
			...context.keyTarget,
			keyCode: "1,1",
			intent: "next",
		},
	]);
	await act(async () => {
		release?.();
	});
	expect(view.host.textContent).toContain("b.mp3");
	expect(view.host.textContent).toContain("2 / 2");
	expect(fake.client.control).not.toHaveBeenCalled();
});

it.each([
	["playing", 1, ""],
	["unconfigured", 0, "Not configured"],
	["failed", 2, "Playback failed"],
] as const)(
	"KNOB-092 WIDGETS-113/117 disables navigation for %s with %i entries",
	async (state, total, message) => {
		const snapshot: LocalPlayerSnapshot = {
			revision: 2,
			state,
			total,
			title: "Track",
			trackIndex: 0,
			positionMs: 0,
			errorCode: state === "failed" ? "QUAKE.SOUNDBOARD.DECODE_FAILED" : null,
		};
		fake.client.request.mockResolvedValue({ _tag: "localPlayer", snapshot });
		const { LocalPlayerCard } = await import("./LocalPlayerCard");
		const raw = Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1"));
		const key = Schema.decodeUnknownSync(ProfileKey)({
			...raw,
			childrenName: "playAudio",
			config: {
				...raw.config,
				type: "playAudio",
				size: [5, 2],
				actions: [
					{ type: "sound", value: "a.mp3" },
					{ type: "audioAction", value: 0 },
				],
			},
		});
		const profile = { id: "p", name: "P", compatibility: Option.none() },
			tile = stripLayout(profile, { keys: [key] }).tiles[0];
		if (!tile) throw new Error("missing tile");
		const view = await mounted(
			<LocalPlayerCard
				tile={tile}
				context={{
					now: undefined,
					hourFormat: "24h",
					voice: previewVoiceContext,
					keyTarget: {
						deviceId: "d",
						profileId: "p",
						pageId: "one",
						revision: 1,
					},
				}}
			/>,
		);
		expect(
			query(
				view.host,
				"[data-testid=audioPlayerViewForwards]",
				HTMLButtonElement,
			).disabled,
		).toBe(true);
		expect(view.host.textContent).toContain(message);
		if (state !== "playing")
			expect(
				query(view.host, "[data-testid=playStop]", HTMLButtonElement).disabled,
			).toBe(true);
	},
);

it("WIDGETS-113 ignores an old local-player snapshot after the active key target changes", async () => {
	const { LocalPlayerCard } = await import("./LocalPlayerCard");
	const snapshot: LocalPlayerSnapshot = {
		revision: 1,
		state: "playing",
		title: "Current key",
		trackIndex: 0,
		total: 2,
		positionMs: 0,
		errorCode: null,
	};
	let release: ((value: unknown) => void) | undefined;
	fake.client.request.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	fake.client.request.mockResolvedValue({ _tag: "localPlayer", snapshot });
	const raw = Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1"));
	const key = Schema.decodeUnknownSync(ProfileKey)({
		...raw,
		childrenName: "playAudio",
		config: { ...raw.config, type: "playAudio", size: [5, 2] },
	});
	const candidate = stripLayout(
		{ name: "P", compatibility: Option.none() },
		{ keys: [key] },
	).tiles[0];
	if (!candidate) throw new Error("missing tile");
	const tile = candidate;
	let select = (_deviceId: string) => {};
	function View() {
		const [deviceId, setDeviceId] = useState("old");
		select = setDeviceId;
		return (
			<LocalPlayerCard
				tile={tile}
				context={{
					now: undefined,
					hourFormat: "24h",
					voice: previewVoiceContext,
					keyTarget: { deviceId, profileId: "p", pageId: "one", revision: 1 },
				}}
			/>
		);
	}
	const view = await mounted(<View />);
	await act(async () => select("new"));
	expect(view.host.textContent).toContain("Current key");
	await act(async () =>
		release?.({
			_tag: "localPlayer",
			snapshot: { ...snapshot, revision: 99, title: "Stale key" },
		}),
	);
	expect(view.host.textContent).toContain("Current key");
	expect(view.host.textContent).not.toContain("Stale key");
});

it("keeps a delayed local read alive across equivalent one-second strip targets", async () => {
	vi.useFakeTimers();
	const { LocalPlayerCard } = await import("./LocalPlayerCard");
	let finish = (_value: unknown) => {};
	fake.client.request.mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const empty = createEmptyProfileKey("1,1");
	const key = {
		...empty,
		config: {
			...empty.config,
			display: true,
			type: "playAudio",
			size: [5, 2] as const,
		},
	};
	const tile = stripLayout(
		{ id: "p", name: "P", compatibility: Option.none() },
		{ keys: [key] },
	).tiles[0];
	if (!tile) throw new Error("missing tile");
	const render = (revision = 1) => (
		<LocalPlayerCard
			tile={tile}
			context={{
				now: new Date(),
				hourFormat: "24h",
				voice: previewVoiceContext,
				keyTarget: { deviceId: "d", profileId: "p", pageId: "one", revision },
			}}
		/>
	);
	const view = await mounted(render());
	for (let i = 0; i < 3; i++) {
		await act(async () => vi.advanceTimersByTime(1000));
		await view.render(render());
	}
	expect(fake.client.request).toHaveBeenCalledTimes(1);
	await act(async () =>
		finish({
			_tag: "localPlayer",
			snapshot: {
				revision: 1,
				state: "playing",
				title: "Slow track",
				trackIndex: 0,
				total: 1,
				positionMs: 0,
				errorCode: null,
			},
		}),
	);
	expect(view.host.textContent).toContain("Slow track");
	await view.render(render());
	expect(view.host.textContent).toContain("Slow track");
	await view.render(render(2));
	expect(view.host.textContent).toContain("Not configured");
	expect(fake.client.request).toHaveBeenCalledTimes(2);
});
