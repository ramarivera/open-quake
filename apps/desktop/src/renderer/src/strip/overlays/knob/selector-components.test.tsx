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
import { stripLayout } from "../../geometry";
import { StripPanel } from "../../StripPanel";
import { StripScreen } from "../../StripScreen";
import {
	type StripProfiles,
	subscribeStripProfiles,
} from "../../useStripProfiles";
import { previewVoiceContext } from "../voice/voice-context";
import { FunctionWheel } from "./FunctionWheel";
import { cardRect, pageArrowRect } from "./geometry";
import { ProfilePicker } from "./ProfilePicker";
import strings from "./strings.json";
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
function picker(count: number, index = 0, locale: keyof typeof strings = "en") {
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

describe("SCREEN-087/088/089/094 rendered picker", () => {
	for (const locale of Object.keys(strings).filter(
		(key): key is keyof typeof strings => key in strings,
	)) {
		it.each([1, 16])(
			`uses ${locale} source labels for %i profiles and renders the canonical settle progress`,
			async (count) => {
				await render(picker(count, 0, locale));
				const copy = strings[locale];
				expect(host.querySelector("header")?.textContent).toContain(copy.title);
				expect(host.querySelector(".knob-current-label")?.textContent).toBe(
					`${copy.currentPrefix} · ${entries(count)[0]?.name}`,
				);
				expect(host.querySelector(".knob-picker-hint")?.textContent).toBe(
					copy.knobHint,
				);
				expect(
					host.querySelector<HTMLElement>(".knob-settle div")?.style.width,
				).toBe("50%");
				if (count > 15) {
					expect(host.querySelector("footer")?.textContent).toContain(
						copy.pageHint,
					);
					expect(host.querySelector(".knob-current-badge")).toBeNull();
				} else {
					expect(host.querySelector("footer")).toBeNull();
					expect(host.querySelector(".knob-current-badge")?.textContent).toBe(
						copy.currentBadge,
					);
				}
			},
		);
	}
	it.each([1, 2, 3, 6, 8, 9, 12, 15, 16, 30, 31])(
		"renders %i cards with the same exact rectangles as touch input on every page",
		async (count) => {
			for (let page = 0; page < Math.ceil(count / 15); page++) {
				await render(picker(count, page * 15));
				const cards = host.querySelectorAll<HTMLElement>(".knob-profile-card");
				expect(cards).toHaveLength(Math.min(15, count - page * 15));
				cards.forEach((card, offset) => {
					const rect = cardRect(count, offset, page);
					expect([
						card.style.left,
						card.style.top,
						card.style.width,
						card.style.height,
					]).toEqual([
						`${rect.x}px`,
						`${rect.y}px`,
						`${rect.width}px`,
						`${rect.height}px`,
					]);
					expect(rect.width / rect.height).toBe(4);
				});
				const focus = host.querySelector<HTMLElement>(".knob-picker-focus");
				const first = cardRect(count, 0, page);
				expect(focus?.style.transform).toBe(
					`translate3d(${first.x}px,${first.y}px,0) scale(1.06)`,
				);
				expect(host.querySelectorAll(".knob-picker-focus")).toHaveLength(1);
			}
		},
	);
	it("draws a placeholder, thumbnail and pressed state and dispatches keyboard select once", async () => {
		await render(picker(3));
		expect(host.querySelectorAll(".knob-card-placeholder")).toHaveLength(2);
		expect(host.querySelectorAll("img")).toHaveLength(1);
		const rect = cardRect(3, 1);
		await act(async () =>
			host.dispatchEvent(
				new CustomEvent("quake-strip-overlay-touch", {
					detail: { x: rect.x + 1, y: rect.y + 1, action: 1 },
				}),
			),
		);
		expect(
			host.querySelector('[data-pressed="true"]')?.getAttribute("aria-label"),
		).toBe("Profile 1");
		await act(async () =>
			host.dispatchEvent(
				new CustomEvent("quake-strip-overlay-touch", {
					detail: { x: rect.x + 1, y: rect.y + 1, action: 0 },
				}),
			),
		);
		expect(request).toHaveBeenCalledExactlyOnceWith({
			_tag: "Select",
			sessionId: "s1",
			profileId: "p1",
		});
	});
	it("renders arrow bounds verbatim and disables hidden first/last arrows", async () => {
		for (const page of [0, 1]) {
			await render(picker(16, page * 15));
			for (const delta of [-1, 1] as const) {
				const arrow = host.querySelector<HTMLButtonElement>(
					`.knob-page-${delta < 0 ? "previous" : "next"}`,
				);
				const rect = pageArrowRect(delta);
				const hidden = delta < 0 ? page === 0 : page === 1;
				expect([
					arrow?.style.left,
					arrow?.style.top,
					arrow?.style.width,
					arrow?.style.height,
				]).toEqual([
					`${rect.x}px`,
					`${rect.y}px`,
					`${rect.width}px`,
					`${rect.height}px`,
				]);
				expect(arrow?.disabled).toBe(hidden);
				expect(arrow?.style.visibility).toBe(hidden ? "hidden" : "visible");
			}
		}
	});
});

describe("SCREEN-075/076/077/080/084 wheel", () => {
	it("announces selection changes in a polite status outside the wheel image", async () => {
		for (const index of [0, 1]) {
			await render(
				<FunctionWheel
					entries={entries(2)}
					index={index}
					direction={1}
					motion="reduce"
				/>,
			);
			const status = host.querySelector('[role="status"]');
			expect(status).not.toBeNull();
			expect(status?.getAttribute("aria-live")).toBe("polite");
			expect(status?.textContent).toBe(entries(2)[index]?.name);
			expect(status?.closest('[role="img"]')).toBeNull();
			expect(
				host.querySelector('[role="img"]')?.getAttribute("aria-label"),
			).toBe("Profile wheel");
		}
	});
	it.each([1, 2, 8])(
		"renders five clipped wrapped names for %i menu entries without management actions",
		async (count) => {
			vi.spyOn(Range.prototype, "getBoundingClientRect").mockReturnValue(
				new DOMRect(0, 0, 1600, 48),
			);
			await render(
				<div className="knob-overlay-root">
					<FunctionWheel
						entries={entries(count)}
						index={count - 1}
						direction={1}
						motion="reduce"
					/>
				</div>,
			);
			const labels = host.querySelectorAll<HTMLElement>(".knob-wheel-label");
			expect(labels).toHaveLength(5);
			expect(labels[2]?.textContent).toBe(entries(count)[count - 1]?.name);
			expect(labels[0]?.style.top).toBe("68.19px");
			expect(labels[4]?.style.top).toBe("401.81px");
			expect(
				host.querySelector<HTMLElement>(".knob-wheel-backdrop")?.style.width,
			).toBe("1000px");
			expect(host.querySelector("button")).toBeNull();
			expect(host.querySelector("svg")).toBeNull();
			expect(host.querySelector(".knob-wheel-direction")).toBeNull();
		},
	);
	it("cancels an interrupted 200ms nudge and 300ms direction indicator, and reduced motion resets immediately", async () => {
		await render(
			<FunctionWheel entries={entries(8)} index={0} direction={1} />,
		);
		await advance(100);
		await render(
			<FunctionWheel entries={entries(8)} index={1} direction={-1} />,
		);
		expect(
			host
				.querySelector(".knob-wheel-direction")
				?.getAttribute("data-direction"),
		).toBe("-1");
		await advance(220);
		expect(
			host.querySelector<HTMLElement>(".knob-wheel-list")?.style.transform,
		).toBe("translateY(0px)");
		expect(host.querySelector(".knob-wheel-direction")).not.toBeNull();
		await advance(80);
		expect(host.querySelector(".knob-wheel-direction")).toBeNull();
		await render(
			<FunctionWheel
				entries={entries(8)}
				index={2}
				direction={1}
				motion="reduce"
			/>,
		);
		expect(
			host.querySelector<HTMLElement>(".knob-wheel-list")?.style.transform,
		).toBe("translateY(0px)");
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
	expect(host.querySelector("footer")?.textContent).toContain("4 / 4");
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
			expect(host.querySelectorAll(".knob-wheel")).toHaveLength(open ? 1 : 0);
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
	expect(host.querySelector(".knob-page-next")?.closest("[inert]")).toBeNull();
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
		expect(host.querySelector(".knob-wheel, .knob-picker")).toBeNull();
	}
});

it("SCREEN-094: touches at rendered arrow edges and hidden arrows use the same bounds", async () => {
	for (const [page, delta] of [
		[0, 1],
		[1, -1],
	] as const) {
		await render(picker(16, page * 15));
		const arrow = host.querySelector<HTMLElement>(
			`.knob-page-${delta === 1 ? "next" : "previous"}`,
		);
		if (!arrow) throw new Error("Missing arrow");
		const x = Number.parseFloat(arrow.style.left),
			y = Number.parseFloat(arrow.style.top);
		const points = [
			[x + 0.1, y + 0.1, true],
			[x + 159.9, y + 219.9, true],
			[delta === 1 ? x - 0.1 : x + 160.1, y + 110, false],
			[delta === 1 ? 0.1 : 1919.9, y + 110, false],
		] as const;
		for (const [px, py, visible] of points) {
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
