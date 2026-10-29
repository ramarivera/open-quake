// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { builtinProfiles } from "../../../../../../../../packages/device/src/profiles/profile-catalog";
import type {
	KnobModelSnapshot,
	MenuProfile,
} from "../../../../../shared/knob-contracts";
import {
	createInitialProfileEnvelope,
	encodeProfileEnvelope,
	type Profile,
	type ProfileEnvelope,
} from "../../../../../shared/profiles";
import recovered from "../../../i18n/recovered.json";
import { stripLayout } from "../../geometry";
import { StripPanel } from "../../StripPanel";
import { StripScreen } from "../../StripScreen";
import {
	type StripProfiles,
	subscribeStripProfiles,
} from "../../useStripProfiles";
import { previewVoiceContext } from "../voice/voice-context";
import { FunctionWheel } from "./FunctionWheel";
import { ProfilePicker } from "./ProfilePicker";
import { sceneSlots, sceneTarget } from "./scene-rail";
import { useKnob } from "./useKnob";
import { useProfileFrame } from "./useProfileFrame";

let root: Root;
let host: HTMLDivElement;
const request = vi.fn(async () => {});
const entries = (count: number): readonly MenuProfile[] =>
	Array.from({ length: count }, (_, i) => ({
		id: `p${i}`,
		name:
			i === 0
				? "Very long current profile name ".repeat(10).trim()
				: `Profile ${i}`,
		colorful: false,
		thumbnail:
			i % 2
				? { _tag: "ready", dataUrl: "data:image/png;base64,AA==" }
				: { _tag: "missing" },
	}));
const snapshot = (count: number, index = 0): KnobModelSnapshot => ({
	context: {
		session: {
			deviceId: "desktop-preview",
			sessionId: "s1",
			profileId: "p0",
			revision: 0,
		},
		profiles: entries(count),
		keys: [],
		player: false,
	},
	revision: 1,
	selector: {
		mode: "picker",
		index,
		page: Math.floor(index / 15),
		progress: 0.5,
		ringVisible: false,
		direction: 1,
	},
	focus: { _tag: "none" },
	volume: { phase: "inactive", level: 0, muted: false },
	notice: "",
});
const render = async (element: React.ReactNode) => {
	await act(async () => root.render(element));
};
const advance = async (ms: number) => {
	await act(async () => vi.advanceTimersByTime(ms));
};
function picker(
	count: number,
	index = 0,
	locale: keyof typeof recovered = "en",
) {
	const state = snapshot(count, index);
	return (
		<div className="knob-overlay-root">
			<ProfilePicker
				snapshot={state}
				entries={state.context.profiles}
				request={request}
				locale={locale}
			/>
		</div>
	);
}
beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	host = document.createElement("div");
	host.id = "root";
	document.body.append(host);
	root = createRoot(host);
	const sheet = document.createElement("style");
	sheet.textContent = readFileSync(
		"src/renderer/src/strip/overlays/knob/knob.css",
		"utf8",
	);
	document.head.append(sheet);
	request.mockClear();
});
afterEach(async () => {
	await act(async () => root.unmount());
	document.body.replaceChildren();
	document.head.replaceChildren();
	delete window.quakeKnob;
	delete window.quakeProfiles;
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("Scene Rail profile selection", () => {
	for (const locale of Object.keys(recovered).filter(
		(key): key is keyof typeof recovered => key in recovered,
	)) {
		it(`localizes current, selected, destination and timeout labels in ${locale}`, async () => {
			await render(picker(4, 1, locale));
			const copy = recovered[locale].picker;
			expect(host.querySelector("h1")?.textContent).toBe(copy.title);
			expect(host.querySelector(".knob-picker-hint")?.textContent).toBe(
				copy.knobHint,
			);
			expect(host.querySelector(".scene-timeout")?.textContent).toBe(
				copy.pageHint,
			);
			expect(
				host.querySelector('[data-current="true"]')?.getAttribute("aria-label"),
			).toBe(entries(4)[0]?.name);
			expect(
				host.querySelector('[data-focused="true"]')?.getAttribute("aria-label"),
			).toBe("Profile 1");
			expect(
				host.querySelector('[data-focused="true"] .scene-card-action')
					?.textContent,
			).toContain(copy.switchTo);
			expect(
				host
					.querySelector('[role="progressbar"]')
					?.getAttribute("aria-valuenow"),
			).toBe("50");
		});
	}
	it.each([0, 1, 2, 3, 16, 31, 46])(
		"renders unique neighbours with matching physical hit regions for %i profiles",
		async (count) => {
			for (const index of new Set([0, Math.max(0, count - 1)])) {
				await render(picker(count, index));
				const slots = sceneSlots(count, index);
				const cards = host.querySelectorAll<HTMLElement>(".knob-profile-card");
				expect(cards).toHaveLength(Math.min(count, 3));
				expect(new Set(slots.map((slot) => slot.index)).size).toBe(
					slots.length,
				);
				cards.forEach((card, i) => {
					const slot = slots[i];
					if (!slot) throw new Error("Missing scene slot");
					expect([
						card.style.left,
						card.style.top,
						card.style.width,
						card.style.height,
					]).toEqual([
						`${slot.rect.x}px`,
						`${slot.rect.y}px`,
						`${slot.rect.width}px`,
						`${slot.rect.height}px`,
					]);
					expect(
						sceneTarget(count, index, slot.rect.x + 5, slot.rect.y + 5),
					).toEqual({ kind: "card", index: slot.index });
				});
			}
		},
	);
	it("routes physical selection once, cancels drags, and closes without selecting", async () => {
		await render(picker(3));
		const slot = sceneSlots(3, 0).find((slot) => slot.position === "next");
		if (!slot) throw new Error("Missing next scene");
		const touch = async (x: number, y: number, action: number) =>
			act(async () => {
				host.dispatchEvent(
					new CustomEvent("quake-strip-overlay-touch", {
						detail: { x, y, action },
					}),
				);
			});
		await touch(slot.rect.x + 10, slot.rect.y + 10, 1);
		expect(
			host.querySelector('[data-pressed="true"]')?.getAttribute("aria-label"),
		).toBe("Profile 1");
		await touch(slot.rect.x + 10, slot.rect.y + 10, 0);
		expect(request).toHaveBeenCalledExactlyOnceWith({
			_tag: "Select",
			sessionId: "s1",
			profileId: "p1",
		});
		request.mockClear();
		await touch(slot.rect.x + 10, slot.rect.y + 10, 1);
		await touch(20, 20, 1);
		await touch(20, 20, 0);
		expect(request).not.toHaveBeenCalled();
		await touch(50, 400, 1);
		await touch(50, 400, 0);
		expect(request).toHaveBeenCalledExactlyOnceWith({
			_tag: "Dismiss",
			sessionId: "s1",
		});
	});
	it("keeps a held physical contact across timer-only snapshot publications", async () => {
		await render(picker(3));
		const slot = sceneSlots(3, 0).find((slot) => slot.position === "next");
		if (!slot) throw new Error("Missing next scene");
		await act(async () => {
			host.dispatchEvent(
				new CustomEvent("quake-strip-overlay-touch", {
					detail: { x: slot.rect.x + 10, y: slot.rect.y + 10, action: 1 },
				}),
			);
		});
		await render(picker(3));
		await act(async () => {
			host.dispatchEvent(
				new CustomEvent("quake-strip-overlay-touch", {
					detail: { x: slot.rect.x + 10, y: slot.rect.y + 10, action: 0 },
				}),
			);
		});
		expect(request).toHaveBeenCalledExactlyOnceWith({
			_tag: "Select",
			sessionId: "s1",
			profileId: "p1",
		});
	});

	it("preserves keyboard selection, dismissal and many-profile paging", async () => {
		await render(picker(31, 15, "de"));
		const next = host.querySelector<HTMLButtonElement>(
			'button[aria-label="Springen zu Profile 30"]',
		);
		await act(async () => next?.click());
		expect(request).toHaveBeenCalledExactlyOnceWith({
			_tag: "Page",
			sessionId: "s1",
			delta: 1,
		});
		request.mockClear();
		await act(async () =>
			host.querySelector<HTMLButtonElement>('[data-focused="true"]')?.click(),
		);
		expect(request).toHaveBeenCalledExactlyOnceWith({
			_tag: "Select",
			sessionId: "s1",
			profileId: "p15",
		});
		request.mockClear();
		await act(async () =>
			host
				.querySelector('[role="dialog"]')
				?.dispatchEvent(
					new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
				),
		);
		expect(request).toHaveBeenCalledExactlyOnceWith({
			_tag: "Dismiss",
			sessionId: "s1",
		});
	});
});

describe("Scene Rail knob feedback", () => {
	it.each([1, 2, 8])(
		"shows unique destinations and announces the selected profile for %i entries",
		async (count) => {
			await render(
				<FunctionWheel
					entries={entries(count)}
					index={count - 1}
					activeId="p0"
					direction={1}
					motion="reduce"
				/>,
			);
			expect(host.querySelector('[role="status"]')?.textContent).toBe(
				entries(count)[count - 1]?.name,
			);
			expect(host.querySelectorAll(".scene-card")).toHaveLength(
				Math.min(3, count),
			);
			expect(
				host.querySelector('[data-focused="true"] .scene-card-name')
					?.textContent,
			).toBe(entries(count)[count - 1]?.name);
			expect(
				host.querySelector("button, svg, .scene-knob-direction"),
			).toBeNull();
			expect(
				host.querySelector(".scene-knob")?.getAttribute("data-motion"),
			).toBe("reduce");
		},
	);
	it("doesn't flash a direction bar or spin an indicator during interrupted turns", async () => {
		for (const index of [0, 1, 4, 2]) {
			await render(
				<FunctionWheel entries={entries(8)} index={index} direction={-1} />,
			);
			await advance(100);
			expect(
				host.querySelector(".scene-knob-direction, circle, .knob-dial"),
			).toBeNull();
			expect(
				host.querySelector('[data-focused="true"] .scene-card-name')
					?.textContent,
			).toBe(entries(8)[index]?.name);
		}
	});
});

it("SCREEN-090: coalescing renders only the latest revision and keeps page, card and focus equal after a delayed read", async () => {
	let push = (_value: unknown) => {};
	let resolveRead = (_value: unknown) => {};
	window.quakeKnob = {
		request: () =>
			new Promise((resolve) => {
				resolveRead = resolve;
			}),
		onSnapshot: (receive) => {
			push = receive;
			return () => {};
		},
	};
	function Consumer() {
		const { snapshot: state } = useKnob();
		return state ? (
			<ProfilePicker
				snapshot={state}
				entries={state.context.profiles}
				request={request}
			/>
		) : null;
	}
	await render(<Consumer />);
	for (let index = 0; index < 46; index++)
		push({ ...snapshot(46, index), revision: index + 1 });
	await advance(16);
	expect(
		host.querySelector('[data-focused="true"]')?.getAttribute("aria-label"),
	).toBe("Profile 45");
	expect(host.querySelector(".scene-count")?.textContent).toBe("46 / 46");
	resolveRead({ _tag: "success", snapshot: snapshot(46) });
	await advance(150);
	expect(
		host.querySelector('[data-focused="true"]')?.getAttribute("aria-label"),
	).toBe("Profile 45");
});

it("SCREEN-079: colorful frame waits for matching committed configuration, falls back at 2000ms, and recovers", async () => {
	const allProfiles = builtinProfiles("darwin");
	const first = allProfiles[0];
	if (!first) throw new Error("Missing built-in profiles");
	const envelope = {
		...createInitialProfileEnvelope(),
		profiles: [first, ...allProfiles.slice(1)] as const,
	};
	const colorful = envelope.profiles.find(
		(profile) => stripLayout(profile, profile.pages[0]).vivid,
	);
	const grid = envelope.profiles.find(
		(profile) => !stripLayout(profile, profile.pages[0]).vivid,
	);
	if (!colorful || !grid) throw new Error("Missing built-in profile fixtures");
	const profiles: StripProfiles = {
		_tag: "ready",
		envelope: {
			...envelope,
			activeByDevice: {
				"desktop-preview": {
					profileId: colorful.id,
					pageId: colorful.pages[0].id,
				},
			},
		},
	};
	const state = {
		...snapshot(1),
		context: {
			...snapshot(1).context,
			session: { ...snapshot(1).context.session, profileId: grid.id },
			profiles: [
				{
					...entries(1)[0],
					id: grid.id,
					name: grid.name,
					colorful: false,
					thumbnail: { _tag: "missing" as const },
				},
			],
		},
	};
	function Frame({
		source,
		target = state,
	}: {
		source: StripProfiles;
		target?: KnobModelSnapshot;
	}) {
		const frame = useProfileFrame(source, target, undefined);
		return (
			<div
				data-pending={frame.pending}
				data-vivid={frame.vivid}
				data-state={frame.profiles._tag}
			/>
		);
	}
	await render(<Frame source={profiles} />);
	expect(host.firstElementChild?.getAttribute("data-vivid")).toBe("true");
	await advance(1999);
	expect(host.firstElementChild?.getAttribute("data-state")).toBe("ready");
	await advance(1);
	expect(host.firstElementChild?.getAttribute("data-state")).toBe("failure");
	await render(
		<Frame
			source={{
				_tag: "ready",
				envelope: {
					...envelope,
					activeByDevice: {
						"desktop-preview": { profileId: grid.id, pageId: grid.pages[0].id },
					},
				},
			}}
		/>,
	);
	expect(host.firstElementChild?.getAttribute("data-pending")).toBe("false");
	expect(host.firstElementChild?.getAttribute("data-state")).toBe("ready");
	const target = {
		...state,
		context: {
			...state.context,
			session: { ...state.context.session, profileId: colorful.id },
			profiles: [
				{
					id: colorful.id,
					name: colorful.name,
					colorful: true,
					thumbnail: { _tag: "missing" as const },
				},
			],
		},
	};
	const gridSource: StripProfiles = {
		_tag: "ready",
		envelope: {
			...envelope,
			activeByDevice: {
				"desktop-preview": { profileId: grid.id, pageId: grid.pages[0].id },
			},
		},
	};
	await render(<Frame source={gridSource} target={target} />);
	expect(host.firstElementChild?.getAttribute("data-pending")).toBe("true");
	expect(host.firstElementChild?.getAttribute("data-vivid")).toBe("true");
	await advance(1999);
	await render(<Frame source={profiles} target={target} />);
	await advance(2000);
	expect(host.firstElementChild?.getAttribute("data-pending")).toBe("false");
	expect(host.firstElementChild?.getAttribute("data-state")).toBe("ready");
});

it("SCREEN-100: a committed push wins over a late initial read", async () => {
	let resolveRead = (_value: unknown) => {};
	let push = (_value: unknown) => {};
	const observed: StripProfiles[] = [];
	const off = subscribeStripProfiles(
		{
			read: () =>
				new Promise((resolve) => {
					resolveRead = resolve;
				}),
			onSnapshot: (receive) => {
				push = receive;
				return () => {};
			},
		},
		(value) => observed.push(value),
	);
	const envelope = createInitialProfileEnvelope();
	push({ _tag: "ready", envelope: encodeProfileEnvelope(envelope) });
	resolveRead({
		_tag: "failure",
		code: "QUAKE.PROFILE.READ_FAILED",
		message: "Late read",
	});
	await advance(0);
	expect(observed).toHaveLength(1);
	expect(observed[0]?._tag).toBe("ready");
	off();
});

it("SCREEN-081/084: clock, monitor and chat content survives wheel entry/exit with no management entry", async () => {
	for (const [type, selector] of [
		["dkDesktopClock", ".oq-clock"],
		["systemMonitorPanel", ".oq-monitor"],
		["aiChatView", ".copilot"],
	] as const) {
		const profile = builtinProfiles("darwin").find((candidate) =>
			candidate.pages[0].keys.some((key) => key.config.type === type),
		);
		if (!profile) throw new Error(`Missing ${type} fixture`);
		const profiles: StripProfiles = {
			_tag: "ready",
			envelope: { ...createInitialProfileEnvelope(), profiles: [profile] },
		};
		for (const open of [false, true, false]) {
			await render(
				<StripScreen
					profiles={profiles}
					showEmptyGridDashedBorder
					voice={{ ...previewVoiceContext, wheelOpen: open }}
					interactive={false}
				>
					{open ? (
						<foreignObject width="1920" height="480">
							<FunctionWheel
								entries={entries(2)}
								index={0}
								direction={1}
								motion="reduce"
							/>
						</foreignObject>
					) : null}
				</StripScreen>,
			);
			expect(host.querySelector(selector)).not.toBeNull();
			expect(
				host.querySelector(".strip-screen")?.getAttribute("data-wheel-open"),
			).toBe(open ? "true" : null);
			expect(host.querySelector(selector)?.textContent?.length).toBeGreaterThan(
				0,
			);
			expect(host.querySelectorAll(".scene-knob")).toHaveLength(open ? 1 : 0);
			if (open && type === "systemMonitorPanel") {
				const card = host.querySelector(".monitor-card");
				if (!card) throw new Error("Missing monitor card");
				expect(getComputedStyle(card).getPropertyValue("backdrop-filter")).toBe(
					"none",
				);
			}
			expect(
				host.querySelector('[aria-label="Open Management Center"]'),
			).toBeNull();
		}
	}
});

it("SCREEN-079: pending profile disables only stale grid input and its published layout", async () => {
	const profile = builtinProfiles("darwin").find((p) => p.id === "1-2");
	if (!profile) throw new Error("Missing grid profile");
	const onLayout = vi.fn();
	await render(
		<StripScreen
			profiles={{
				_tag: "ready",
				envelope: { ...createInitialProfileEnvelope(), profiles: [profile] },
			}}
			pendingProfile
			showEmptyGridDashedBorder
			onLayout={onLayout}
		>
			<foreignObject width="1920" height="480">
				{picker(16)}
			</foreignObject>
		</StripScreen>,
	);
	expect(host.querySelector(".strip-grid")?.hasAttribute("inert")).toBe(true);
	expect(host.querySelector(".strip-screen")?.hasAttribute("inert")).toBe(
		false,
	);
	expect(
		host.querySelector(".scene-pages button")?.closest("[inert]"),
	).toBeNull();
	expect(onLayout).toHaveBeenLastCalledWith(undefined);
});

it("SCREEN-100/106: StripPanel paints committed add/edit/delete snapshots without opening selectors", async () => {
	const template = builtinProfiles("darwin").find((p) => p.id === "1-2");
	if (!template) throw new Error("Missing profile fixture");
	const makeProfile = (id: string, label: string): Profile => ({
		...template,
		id,
		name: label,
		pages: [
			{
				...template.pages[0],
				keys: template.pages[0].keys.map((key, i) =>
					i === 0
						? {
								...key,
								config: {
									...key.config,
									title: {
										...key.config.title,
										text: label,
										i18nKey: undefined,
									},
								},
							}
						: key,
				),
			},
		],
	});
	const a = makeProfile("a", "Alpha");
	const b = makeProfile("b", "Beta");
	const c = makeProfile("c", "Gamma");
	const envelope = (
		profiles: ProfileEnvelope["profiles"],
		active: string,
	): ProfileEnvelope => ({
		...createInitialProfileEnvelope(),
		profiles,
		activeByDevice: {
			"desktop-preview": { profileId: active, pageId: profiles[0].pages[0].id },
		},
	});
	let push = (_value: unknown) => {};
	window.quakeProfiles = {
		read: async () => ({
			_tag: "ready",
			envelope: encodeProfileEnvelope(envelope([a, b], "b")),
		}),
		onSnapshot: (listener) => {
			push = listener;
			return () => {};
		},
	};
	await render(<StripPanel />);
	const title = () =>
		host.querySelector('.strip-slot[data-key-code="1,1"] .strip-tile-title')
			?.textContent;
	expect(title()).toBe("Beta");
	for (const [profiles, active, expected] of [
		[[a, b, c], "b", "Beta"],
		[[c, a, makeProfile("b", "Renamed")], "b", "Renamed"],
		[[c, a], "c", "Gamma"],
	] as const) {
		await act(async () =>
			push({
				_tag: "ready",
				envelope: encodeProfileEnvelope(envelope(profiles, active)),
			}),
		);
		expect(title()).toBe(expected);
		expect(host.querySelector(".scene-knob, .knob-picker")).toBeNull();
	}
});

it("SCREEN-094: physical page controls retain their boundaries and disable the unavailable direction", async () => {
	for (const [page, delta, x] of [
		[0, 1, 142],
		[1, -1, 36],
	] as const) {
		await render(picker(16, page * 15));
		for (const [px, py, visible] of [
			[x + 0.1, 288.1, true],
			[x + 89.9, 335.9, true],
			[x - 0.1, 310, false],
			[x + 90.1, 310, false],
		] as const) {
			request.mockClear();
			for (const action of [1, 0])
				await act(async () => {
					host.dispatchEvent(
						new CustomEvent("quake-strip-overlay-touch", {
							detail: { x: px, y: py, action },
						}),
					);
				});
			expect(request).toHaveBeenCalledExactlyOnceWith(
				visible
					? { _tag: "Page", sessionId: "s1", delta }
					: { _tag: "Dismiss", sessionId: "s1" },
			);
		}
	}
});
