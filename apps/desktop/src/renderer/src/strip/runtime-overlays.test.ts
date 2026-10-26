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
		expect(chip()?.textContent).toBe("2");
		const countdown = chip();
		if (!countdown) throw new Error("Missing countdown");
		expect(getComputedStyle(countdown).backgroundColor).toBe("#1e2124");
		expect(
			view.container.querySelector('[data-key-code="1,2"] .strip-key-state'),
		).toBeNull();
		await act(async () => {
			await runtime.runPromise(TestClock.adjust("1 second"));
		});
		expect(chip()?.textContent).toBe("1");
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
		expect(chip()).toBeNull();
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
		expect(
			view.container.querySelector('[data-kind="alarm"]')?.textContent,
		).toBe("Alarm");
		await act(async () => {
			accept(
				Schema.decodeUnknownSync(KeyRuntimeState)({
					deviceId: "desktop-preview",
					profileId: "runtime",
					pageId: "one",
					keyCode: "1,2",
					progress: 42,
					alert: 1,
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
		expect(getComputedStyle(progress).height).toBe("6px");
		expect(progress.firstElementChild?.getAttribute("style")).toBe(
			"width: 42%;",
		);
		expect(
			view.container.querySelector(
				'[data-key-code="1,2"] [data-kind="invalid"]',
			)?.textContent,
		).toBe("Invalid operation");
		await act(async () => {
			accept(
				Schema.decodeUnknownSync(KeyRuntimeState)({
					deviceId: "desktop-preview",
					profileId: "runtime",
					pageId: "one",
					keyCode: "1,2",
					progress: 100,
					alert: 0,
				}),
			);
		});
		expect(view.container.querySelector('[role="progressbar"]')).toBeNull();
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
