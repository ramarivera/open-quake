// @vitest-environment happy-dom
import { Option, Schema } from "effect";
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
	MonitorBridge,
	MonitorSnapshot,
} from "../../../shared/monitor-contracts";
import {
	createEmptyProfileKey,
	type Profile,
	ProfileEnvelope,
} from "../../../shared/profiles";
import { mount, settle } from "../../test/dom";
import { ProfilePreview } from "../profiles/ProfileViews";
import { previewVoiceContext } from "./overlays/voice/voice-context";
import { StripPanel } from "./StripPanel";
import { StripScreen } from "./StripScreen";
import { STRIP_SETTINGS_KEY, useStripSettings } from "./stripSettings";
import { previewSnapshot } from "./tiles/monitor/view-model";

const cleanups: Array<() => void | Promise<void>> = [];
beforeEach(() => {
	vi.stubGlobal("BroadcastChannel", undefined);
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			disconnect() {}
		},
	);
	vi.stubGlobal("matchMedia", () => ({
		matches: false,
		addEventListener() {},
		removeEventListener() {},
	}));
	vi.stubGlobal("IntersectionObserver", undefined);
});
afterEach(async () => {
	for (const close of cleanups.splice(0).reverse()) await close();
	localStorage.clear();
	window.history.replaceState({}, "", "/");
	vi.unstubAllGlobals();
});
const profile = (types: readonly string[] = ["hotkey"]): Profile => ({
	id: "strip-test",
	name: "Custom",
	revision: 0,
	knob: Option.none(),
	compatibility: Option.none(),
	pages: [
		{
			id: "1",
			compatibility: Option.none(),
			keys: types.map((type, index) => {
				const key = createEmptyProfileKey(
					`${Math.floor(index / 8) + 1},${(index % 8) + 1}`,
				);
				return {
					...key,
					childrenName: Option.some(type),
					config: {
						...key.config,
						type,
						title: { ...key.config.title, text: `${type}-${index}` },
					},
				};
			}),
		},
	],
});
const envelope = (p = profile()): ProfileEnvelope => ({
	schemaVersion: 1,
	profiles: [p],
	activeByDevice: {},
	manager: Option.none(),
});
function SavedScreen() {
	const { settings } = useStripSettings();
	return (
		<StripScreen
			profiles={{ _tag: "ready", envelope: envelope() }}
			showEmptyGridDashedBorder={settings.showEmptyGridDashedBorder}
		/>
	);
}

it("MGMT-055 SCREEN-030 SETTINGS-013 applies saved borders to mounted panel, preview and profile thumbnail", async () => {
	localStorage.setItem(
		STRIP_SETTINGS_KEY,
		JSON.stringify({ version: 1, showEmptyGridDashedBorder: false }),
	);
	const encoded = Schema.encodeSync(ProfileEnvelope)(envelope());
	vi.stubGlobal("quakeProfiles", {
		read: async () => ({ _tag: "ready", envelope: encoded }),
		onSnapshot: () => () => {},
	});
	const m = await mount(
		<>
			<StripPanel />
			<SavedScreen />
			<ProfilePreview profile={profile()} />
		</>,
	);
	cleanups.push(m.close);
	await settle(() =>
		expect(
			m.host.querySelectorAll('.strip-screen[data-dashed="false"]'),
		).toHaveLength(3),
	);
	await settle(() =>
		expect(
			Array.from(m.host.querySelectorAll(".strip-screen")).map((s) =>
				s.getAttribute("data-profiles"),
			),
		).toEqual(["ready", "ready", "ready"]),
	);
	for (const show of [true, false, true]) {
		await act(async () =>
			window.dispatchEvent(
				new StorageEvent("storage", {
					key: STRIP_SETTINGS_KEY,
					newValue: JSON.stringify({
						version: 1,
						showEmptyGridDashedBorder: show,
					}),
				}),
			),
		);
		expect(
			m.host.querySelectorAll(`.strip-screen[data-dashed="${show}"]`),
		).toHaveLength(3);
		for (const screen of m.host.querySelectorAll(".strip-screen")) {
			expect(screen.querySelectorAll('[data-state="empty"]')).toHaveLength(15);
			expect(screen.querySelectorAll('[data-state="tile"]')).toHaveLength(1);
		}
	}
});

it("WIDGETS-001 dispatches all metric types from decoded live samples and retains one watch when a cell disappears", async () => {
	window.history.replaceState({}, "", "?surface=panel");
	const listeners = new Set<(value: unknown) => void>();
	const push = (value: unknown) => {
		for (const listener of listeners) listener(value);
	};
	const off = vi.fn();
	const request = vi.fn<MonitorBridge["request"]>(async () => ({
		_tag: "cancelled",
	}));
	vi.stubGlobal("quakeMonitor", {
		request,
		onSettings: () => () => {},
		onMetrics: (callback: (v: unknown) => void) => {
			listeners.add(callback);
			return () => {
				listeners.delete(callback);
				off();
			};
		},
	});
	const p = profile([
		"cpuInfo",
		"gpuInfo",
		"memInfo",
		"diskInfo",
		"powerInfo",
		"networkInfo",
		"bluetoothInfo",
		"processInfo",
	]);
	const show = (p: Profile) => (
		<StripScreen
			profiles={{ _tag: "ready", envelope: envelope(p) }}
			showEmptyGridDashedBorder={true}
			voice={{ ...previewVoiceContext, surface: "panel" }}
		/>
	);
	const m = await mount(show(p));
	cleanups.push(m.close);
	expect(m.host.querySelectorAll(".monitor-metric-tile")).toHaveLength(8);
	expect(
		request.mock.calls.filter(([c]) => c._tag === "watch" && c.active),
	).toHaveLength(1);
	const snapshot: MonitorSnapshot = previewSnapshot();
	await act(async () => push(snapshot));
	const text = (id: string) =>
		m.host.querySelector(`[data-metric="${id}"]`)?.textContent;
	expect(text("cpu")).toContain("37%");
	expect(text("gpu")).toContain("12%");
	expect(text("memory")).toContain("19 GB");
	expect(text("disk")).toContain("3");
	expect(text("power")).toContain("87%");
	expect(text("network")).toContain("12.4MB/s");
	expect(text("process")).toContain("284");
	expect(text("bluetooth")).toContain("unsupported");
	await act(async () =>
		push({
			sampledAt: 2,
			samples: [
				{
					id: "cpu",
					state: "available",
					collectedAt: 2,
					values: { load: "broken" },
				},
			],
		}),
	);
	expect(text("cpu")).toContain("37%");
	await act(async () =>
		push({
			sampledAt: 3,
			samples: [
				{ id: "cpu", state: "available", collectedAt: 3, values: { load: 0 } },
			],
		}),
	);
	expect(text("cpu")).toContain("0%");
	expect(text("memory")).toContain("unavailable");
	await m.render(
		show({ ...p, pages: [{ ...p.pages[0], keys: p.pages[0].keys.slice(1) }] }),
	);
	expect(
		request.mock.calls.filter(([c]) => c._tag === "watch" && !c.active),
	).toHaveLength(0);
	await m.render(null);
	expect(off).toHaveBeenCalledTimes(8);
	expect(
		request.mock.calls.filter(([c]) => c._tag === "watch" && !c.active),
	).toHaveLength(1);
});

it("WIDGETS-001 keeps metric preview fixtures labelled and never watches live metrics", async () => {
	const request = vi.fn(async () => ({ _tag: "cancelled" }));
	vi.stubGlobal("quakeMonitor", { request, onSettings: () => () => {} });
	const m = await mount(
		<ProfilePreview profile={profile(["cpuInfo", "memInfo"])} />,
	);
	cleanups.push(m.close);
	expect(m.host.querySelectorAll(".monitor-metric-tile")).toHaveLength(2);
	expect(m.host.textContent).toContain("Sample data");
	expect(request.mock.calls.some((args) => args.length > 0)).toBe(true);
	expect(request).not.toHaveBeenCalledWith({ _tag: "watch", active: true });
});

it("SCREEN-035/036 replaces all sixteen current cells repeatedly without an artwork gate", async () => {
	const m = await mount(null);
	cleanups.push(m.close);
	for (const name of [
		"Custom",
		"MeetAI",
		"SysView",
		"Custom",
		"SysView",
		"MeetAI",
	]) {
		const p = profile(Array.from({ length: 16 }, () => "hotkey"));
		const next: Profile = {
			...p,
			name,
			pages: [
				{
					...p.pages[0],
					keys: p.pages[0].keys.map((k) => ({
						...k,
						config: {
							...k.config,
							icon: "resource:delayed",
							title: { ...k.config.title, text: `${name}-${k.keyCode}` },
						},
					})),
				},
			],
		};
		await m.render(
			<>
				<StripScreen
					profiles={{ _tag: "ready", envelope: envelope(next) }}
					showEmptyGridDashedBorder={true}
				/>
				<StripScreen
					interactive={false}
					profiles={{ _tag: "ready", envelope: envelope(next) }}
					showEmptyGridDashedBorder={true}
				/>
			</>,
		);
		for (const screen of m.host.querySelectorAll(".strip-screen")) {
			expect(screen.querySelectorAll('[data-state="tile"]')).toHaveLength(16);
			expect(screen.querySelectorAll(".strip-tile-title")).toHaveLength(16);
			for (const title of screen.querySelectorAll(".strip-tile-title"))
				expect(title.textContent).toContain(`${name}-`);
		}
	}
});

it("WIDGETS-010 bounds feedback to 200ms, clears release, and excludes every conversation type and permits feedback for legacy-locked previews", async () => {
	vi.useFakeTimers();
	const m = await mount(null);
	cleanups.push(m.close);
	const show = async (type: string, pressed = true, locked = false) => {
		const p = profile([type]);
		const key = p.pages[0].keys[0];
		if (!key) throw new Error("Missing fixture");
		const next: Profile = {
			...p,
			pages: [
				{
					...p.pages[0],
					keys: [
						{
							...key,
							config: {
								...key.config,
								basicEditableItems: locked
									? Option.some({
											title: true,
											grid: true,
											icon: true,
											allowDrag: false,
											allowDelete: true,
										})
									: Option.none(),
							},
						},
					],
				},
			],
		};
		await m.render(
			<StripScreen
				interactive={!locked}
				profiles={{ _tag: "ready", envelope: envelope(next) }}
				pressedKeyCode={pressed ? "1,1" : undefined}
				showEmptyGridDashedBorder={true}
			/>,
		);
	};
	try {
		await show("hotkey");
		expect(m.host.querySelector('[data-pressed="true"]')).not.toBeNull();
		await act(async () => vi.advanceTimersByTime(199));
		expect(m.host.querySelector('[data-pressed="true"]')).not.toBeNull();
		await act(async () => vi.advanceTimersByTime(1));
		expect(m.host.querySelector('[data-pressed="true"]')).toBeNull();
		await show("hotkey", false);
		await show("hotkey");
		expect(m.host.querySelector('[data-pressed="true"]')).not.toBeNull();
		await show("hotkey", false);
		expect(m.host.querySelector('[data-pressed="true"]')).toBeNull();
		for (const type of [
			"liveAudioTranslateDisplay",
			"aiChatView",
			"quakeBot",
			"cameraView",
			"cameraControlView",
			"printerStatusView",
		]) {
			await show(type, false);
			await show(type);
			expect(m.host.querySelector('[data-pressed="true"]')).toBeNull();
		}
		await show("hotkey", false, true);
		await show("hotkey", true, true);
		expect(m.host.querySelector('[data-pressed="true"]')).not.toBeNull();
	} finally {
		vi.useRealTimers();
	}
});
