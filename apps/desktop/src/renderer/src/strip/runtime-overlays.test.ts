// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	Effect,
	Layer,
	ManagedRuntime,
	Option,
	Schema,
	TestClock,
	TestContext,
} from "effect";
import { act, createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
	KeyRuntime,
	KeyRuntimePort,
} from "../../../../../../packages/device/src/actions/key-runtime-service";
import { createEmptyProfileKey } from "../../../../../../packages/device/src/profiles/profile-contracts";
import { resetKeysOnLinkLoss } from "../../../main/key-library/device-status";
import { KeyRuntimeState } from "../../../shared/key-library";
import type { ProfileEnvelope } from "../../../shared/profiles";
import { mount } from "../test/mount";
import { StripScreen } from "./StripScreen";

afterEach(() => vi.unstubAllGlobals());

it("WIDGETS-107: real timer feedback expires, stays scoped, and link loss clears rendered state", async () => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	const base = createEmptyProfileKey("1,1");
	const timer = {
		...base,
		childrenName: Option.some("timer"),
		config: {
			...base.config,
			type: "timer",
			display: true,
			actions: [
				{ type: "time", value: 2000 },
				{ type: "sound", value: "" },
			],
		},
	};
	let envelope: ProfileEnvelope = {
		schemaVersion: 1,
		manager: Option.none(),
		profiles: [
			{
				id: "runtime",
				name: "Runtime",
				revision: 0,
				compatibility: Option.none(),
				knob: Option.none(),
				pages: [
					{
						id: "one",
						compatibility: Option.none(),
						keys: [
							timer,
							{
								...base,
								keyCode: "1,2",
								config: { ...base.config, type: "hotkey", display: true },
							},
						],
					},
				],
			},
			{
				id: "other",
				name: "Other",
				revision: 0,
				compatibility: Option.none(),
				knob: Option.none(),
				pages: [{ id: "one", compatibility: Option.none(), keys: [timer] }],
			},
		],
		activeByDevice: {
			"desktop-preview": { profileId: "runtime", pageId: "one" },
		},
	};
	let accept: (state: KeyRuntimeState) => void = () => {};
	window.quakeKeyLibrary = {
		request: async () => ({ _tag: "success", states: [] }),
		onPreview: () => () => {},
		onRuntime: (callback) => {
			accept = callback;
			return () => {
				accept = () => {};
			};
		},
	};
	const runtime = ManagedRuntime.make(
		KeyRuntime.DefaultWithoutDependencies.pipe(
			Layer.provide(
				Layer.succeed(KeyRuntimePort, {
					read: Effect.sync(() => envelope),
					execute: () => Effect.void,
					select: () => Effect.void,
					alarm: () => Effect.void,
					publish: (state) =>
						Effect.sync(() =>
							accept(Schema.decodeUnknownSync(KeyRuntimeState)(state)),
						),
				}),
			),
			Layer.provideMerge(TestContext.TestContext),
		),
	);
	const render = () =>
		createElement(StripScreen, {
			profiles: { _tag: "ready", envelope },
			showEmptyGridDashedBorder: false,
			interactive: false,
			previewSerial: "desktop-preview",
		});
	const css = document.createElement("style");
	css.textContent = readFileSync(
		resolve("src/renderer/src/strip/strip.css"),
		"utf8",
	);
	document.head.append(css);
	const view = await mount(render());
	const chip = () => view.container.querySelector('[data-kind="countdown"]');
	try {
		await act(async () => {
			await runtime.runPromise(
				KeyRuntime.activate("desktop-preview", "1,1", "press"),
			);
		});
		expect(chip()?.textContent).toBe("00:00:02");
		const countdown = chip();
		if (!countdown) throw new Error("Missing countdown");
		expect(getComputedStyle(countdown).fontSize).toBe("48px");
		expect(getComputedStyle(countdown).color).toBe("#0000ff");
		expect(
			view.container.querySelector('[data-key-code="1,2"] .strip-key-state'),
		).toBeNull();
		await act(async () => {
			await runtime.runPromise(TestClock.adjust("1 second"));
		});
		expect(chip()?.textContent).toBe("00:00:01");
		envelope = {
			...envelope,
			activeByDevice: {
				"desktop-preview": { profileId: "other", pageId: "one" },
			},
		};
		await view.render(render());
		expect(chip()).toBeNull();
		await act(async () => {
			await runtime.runPromise(TestClock.adjust("1 second"));
		});
		expect(view.container.querySelector(".strip-key-state")).toBeNull();
		envelope = {
			...envelope,
			activeByDevice: {
				"desktop-preview": { profileId: "runtime", pageId: "one" },
			},
		};
		await act(async () => {
			await runtime.runPromise(KeyRuntime.refresh("desktop-preview"));
		});
		await view.render(render());
		expect(chip()?.textContent).toBe("00:00:00");
		expect(view.container.querySelector('[data-kind="alarm"]')).toBeNull();
		await act(async () => {
			await runtime.runPromise(
				KeyRuntime.activate("desktop-preview", "1,1", "release"),
			);
			await runtime.runPromise(
				KeyRuntime.activate("desktop-preview", "1,1", "press"),
			);
			await runtime.runPromise(TestClock.adjust("2 seconds"));
		});
		expect(chip()).toBeNull(); // First activation after expiry clears zero only.
		await act(async () => {
			await runtime.runPromise(
				KeyRuntime.displayEvent({
					type: "progress",
					deviceId: "desktop-preview",
					profileId: "runtime",
					pageId: "one",
					revision: 0,
					keyCode: "1,2",
					percent: 42,
				}),
			);
			await runtime.runPromise(
				KeyRuntime.displayEvent({
					type: "showAlert",
					deviceId: "desktop-preview",
					profileId: "runtime",
					pageId: "one",
					revision: 0,
					keyCode: "1,2",
					alertType: 1,
				}),
			);
		});
		expect(
			view.container
				.querySelector('[data-key-code="1,2"] [role="progressbar"]')
				?.getAttribute("aria-valuenow"),
		).toBe("42");
		const progress = view.container.querySelector('[role="progressbar"]');
		if (!progress) throw new Error("Missing progress");
		expect(getComputedStyle(progress).backgroundColor).toBe("#0a0a1a");
		const failure = view.container.querySelector('[data-kind="invalid"]');
		if (!failure) throw new Error("Missing invalid alert");
		expect(Number(getComputedStyle(failure).zIndex)).toBeGreaterThan(
			Number(getComputedStyle(progress).zIndex),
		);
		expect(progress.firstElementChild?.getAttribute("style")).toContain(
			"width: 42%;",
		);
		expect(
			view.container
				.querySelector('[data-key-code="1,2"] [data-kind="invalid"]')
				?.getAttribute("aria-label"),
		).toBe("Invalid operation");
		await act(async () => {
			await runtime.runPromise(
				KeyRuntime.displayEvent({
					type: "progress",
					deviceId: "desktop-preview",
					profileId: "runtime",
					pageId: "one",
					revision: 0,
					keyCode: "1,2",
					percent: 100,
				}),
			);
			await runtime.runPromise(
				KeyRuntime.displayEvent({
					type: "showAlert",
					deviceId: "desktop-preview",
					profileId: "runtime",
					pageId: "one",
					revision: 0,
					keyCode: "1,2",
					alertType: 0,
				}),
			);
		});
		expect(
			view.container
				.querySelector('[role="progressbar"]')
				?.getAttribute("aria-valuenow"),
		).toBe("100");
		await act(async () => {
			await resetKeysOnLinkLoss(
				{
					source: "mock",
					kind: "status",
					state: "disconnected",
					reason: "scope-closed",
				},
				() => runtime.runPromise(KeyRuntime.reset()),
			);
		});
		expect(view.container.querySelector(".strip-key-state")).toBeNull();
	} finally {
		await view.unmount();
		await runtime.dispose();
		css.remove();
	}
});

it("SCREEN-038 MGMT-172: targeted artwork is immutable and page indicator follows all ten saved pages", async () => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	const icon = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
	const keys = ["hotkey", "hotkey", "pageNo"].map((type, index) => {
		const base = createEmptyProfileKey(`1,${index + 1}`);
		return {
			...base,
			childrenName: Option.some(type),
			config: { ...base.config, type, icon, display: true },
		};
	});
	let envelope: ProfileEnvelope = {
		schemaVersion: 1,
		manager: Option.none(),
		activeByDevice: { device: { profileId: "p", pageId: "page-1" } },
		profiles: [
			{
				id: "p",
				name: "P",
				revision: 0,
				compatibility: Option.none(),
				knob: Option.none(),
				pages: [
					{ id: "page-1", compatibility: Option.none(), keys },
					...Array.from({ length: 9 }, (_, i) => ({
						id: `page-${i + 2}`,
						compatibility: Option.none(),
						keys,
					})),
				],
			},
		],
	};
	let accept: (state: KeyRuntimeState) => void = () => {};
	window.quakeKeyLibrary = {
		request: async () => ({ _tag: "success", states: [] }),
		onPreview: () => () => {},
		onRuntime: (callback) => {
			accept = callback;
			return () => {};
		},
	};
	const runtime = ManagedRuntime.make(
		KeyRuntime.DefaultWithoutDependencies.pipe(
			Layer.provide(
				Layer.succeed(KeyRuntimePort, {
					read: Effect.sync(() => envelope),
					execute: () => Effect.void,
					alarm: () => Effect.void,
					select: (deviceId, profileId, pageId) =>
						Effect.sync(() => {
							envelope = {
								...envelope,
								activeByDevice: { [deviceId]: { profileId, pageId } },
							};
						}),
					publish: (state) =>
						Effect.sync(() =>
							accept(Schema.decodeUnknownSync(KeyRuntimeState)(state)),
						),
				}),
			),
			Layer.provideMerge(TestContext.TestContext),
		),
	);
	const render = () =>
		createElement(StripScreen, {
			profiles: { _tag: "ready", envelope },
			showEmptyGridDashedBorder: false,
			interactive: false,
			previewSerial: "device",
		});
	const view = await mount(render());
	try {
		const image = (code: string) =>
			view.container
				.querySelector(`[data-key-code="${code}"] img`)
				?.getAttribute("src");
		expect(image("1,1")).toBe(icon);
		const replacement =
			'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
		const event = {
			type: "showAnimation",
			deviceId: "device",
			profileId: "p",
			pageId: "page-1",
			revision: 0,
			keyCode: "1,1",
			resourceId: replacement,
		};
		await act(async () => {
			await runtime.runPromise(KeyRuntime.displayEvent(event));
		});
		expect(image("1,1")).toBe(replacement);
		for (const resourceId of [
			"https://external.invalid/image.png",
			"file:///private/image.png",
			"data:image/svg+xml," +
				encodeURIComponent(
					'<svg xmlns="http://www.w3.org/2000/svg"><image href="https://external.invalid/image.png"/></svg>',
				),
		]) {
			await act(async () => {
				await runtime.runPromise(
					KeyRuntime.displayEvent({ ...event, resourceId }),
				);
			});
			expect(image("1,1") ?? "").toBe("");
			expect(image("1,2")).toBe(icon);
		}
		await act(async () => {
			await runtime.runPromise(KeyRuntime.displayEvent(event));
		});
		expect(image("1,1")).toBe(replacement);
		expect(image("1,2")).toBe(icon);
		expect(envelope.profiles[0].pages[0].keys[0]?.config.icon).toBe(icon);
		await act(async () => {
			await runtime.runPromise(
				KeyRuntime.displayEvent({ ...event, revision: 1, resourceId: "stale" }),
			);
			await runtime.runPromise(
				KeyRuntime.displayEvent({
					...event,
					keyCode: "9,9",
					resourceId: "unknown",
				}),
			);
		});
		expect(image("1,1")).toBe(replacement);
		for (let page = 1; page <= 10; page++) {
			await act(async () => {
				await runtime.runPromise(KeyRuntime.navigate("device", 1, page));
			});
			await view.render(render());
			expect(
				view.container.querySelector("[data-page-number]")?.textContent,
			).toBe(String(page));
		}
		envelope = {
			...envelope,
			profiles: [{ ...envelope.profiles[0], revision: 1 }],
		};
		await runtime.runPromise(KeyRuntime.navigate("device", 1, 1));
		await view.render(render());
		expect(image("1,1")).toBe(icon);
	} finally {
		await view.unmount();
		await runtime.dispose();
	}
});
