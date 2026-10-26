// @vitest-environment happy-dom
import {
	Effect,
	Layer,
	ManagedRuntime,
	Option,
	TestClock,
	TestContext,
} from "effect";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	KeyRuntime,
	KeyRuntimePort,
} from "../../../../../../packages/device/src/actions/key-runtime-service";
import { builtinProfiles } from "../../../../../../packages/device/src/profiles/profile-catalog";
import type { QuakeEvent } from "../../../preload/quake";
import type { KeyRequest } from "../../../shared/key-library";
import {
	createInitialProfileEnvelope,
	encodeProfileEnvelope,
	type Profile,
	type ProfileEnvelope,
} from "../../../shared/profiles";
import { StripPanel } from "./StripPanel";

const disposals: Array<() => void | Promise<void>> = [];
beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("matchMedia", () => ({
		matches: true,
		addEventListener: () => {},
		removeEventListener: () => {},
	}));
	window.history.replaceState({}, "", "?surface=panel&serial=matrix-device");
});
afterEach(async () => {
	for (const dispose of disposals.splice(0).reverse()) await dispose();
	document.body.replaceChildren();
	window.history.replaceState({}, "", "/");
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

async function mountedMatrix(options: { delayFirstDown?: boolean } = {}) {
	const base = builtinProfiles("darwin")[0];
	const original = base?.pages[0].keys[0];
	if (!base || !original) throw new Error("Missing builtin key fixture");
	const profile: Profile = {
		...base,
		id: "matrix-profile",
		pages: [
			{
				id: "matrix-page",
				compatibility: Option.none(),
				keys: ["text", "hotkey", "emoji"].map((type, index) => ({
					...original,
					keyCode: `1,${index + 1}`,
					childrenName: Option.some(type),
					config: {
						...original.config,
						type,
						display: true,
						supportKnob: false,
						actions:
							type === "text"
								? [{ type: "text", value: "matrix text" }]
								: type === "hotkey"
									? [{ type: "hotkey", value: "control+a" }]
									: [],
					},
				})),
			},
		],
	};
	const envelope: ProfileEnvelope = {
		...createInitialProfileEnvelope(),
		profiles: [profile],
		activeByDevice: {
			"matrix-device": { profileId: profile.id, pageId: "matrix-page" },
		},
	};
	const effects: string[] = [];
	const runtime = ManagedRuntime.make(
		KeyRuntime.DefaultWithoutDependencies.pipe(
			Layer.provide(
				Layer.succeed(KeyRuntimePort, {
					read: Effect.succeed(envelope),
					execute: (config) =>
						Effect.sync(() => {
							effects.push(config.type);
						}),
					holdHotkey: () =>
						Effect.sync(() => {
							effects.push("hold");
							return Effect.sync(() => {
								effects.push("release");
							});
						}),
					publish: () => Effect.void,
					select: () => Effect.void,
					alarm: () => Effect.void,
				}),
			),
		).pipe(Layer.provideMerge(TestContext.TestContext)),
	);
	disposals.push(() => runtime.dispose());
	const pending = new Set<Promise<unknown>>();
	const request = vi.fn(async (command: KeyRequest) => {
		if (command.type === "activate") {
			const work = runtime.runPromise(
				KeyRuntime.activate(
					command.deviceId,
					command.keyCode,
					command.kind,
					command,
				).pipe(
					Effect.tap(() =>
						options.delayFirstDown &&
						command.keyCode === "1,2" &&
						command.kind === "down"
							? Effect.sleep(100)
							: Effect.void,
					),
					Effect.either,
				),
			);
			pending.add(work);
			try {
				const result = await work;
				if (result._tag === "Left")
					return { _tag: "rejected" as const, reason: result.left.code };
			} finally {
				pending.delete(work);
			}
		}
		return { _tag: "success" as const };
	});
	const listeners = new Set<(event: QuakeEvent) => void>();
	vi.stubGlobal("openQuake", {
		version: "test",
		onQuakeEvent: (listener: (event: QuakeEvent) => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	});
	vi.stubGlobal("quakeProfiles", {
		read: async () => ({
			_tag: "ready",
			envelope: encodeProfileEnvelope(envelope),
		}),
		onSnapshot: () => () => {},
	});
	vi.stubGlobal("quakeKeyLibrary", {
		request,
		onPreview: () => () => {},
		onRuntime: () => () => {},
	});
	const emojiPress = vi.fn(async () => ({ _tag: "success" as const }));
	vi.stubGlobal("quakeEmoji", { press: emojiPress });
	const node = document.createElement("div");
	node.id = "root";
	document.body.append(node);
	const root = createRoot(node);
	disposals.push(async () => {
		await act(async () => root.unmount());
	});
	await act(async () => root.render(<StripPanel />));
	expect(node.querySelector('[data-key-code="1,1"]')).not.toBeNull();
	const emit = async (event: QuakeEvent, settle = true) => {
		await act(async () => {
			for (const listener of listeners) listener(event);
			// Drain the dispatcher's chained requests and the real Effect runtime.
			for (let i = 0; i < 10; i++) {
				await Promise.resolve();
				if (settle) await Promise.all(pending);
			}
		});
	};
	return {
		clock: (ms: number) => runtime.runPromise(TestClock.adjust(ms)),
		effects,
		request,
		emojiPress,
		node,
		matrix: (index: number, settle = true) =>
			emit(
				{
					source: "mock",
					kind: "matrix",
					matrix: {
						reserved: [0, 0, 0, 0],
						states: Array.from({ length: 15 }, (_, i) => (i === index ? 1 : 0)),
						tail: [],
					},
				},
				settle,
			),
		disconnect: () =>
			emit({
				source: "mock",
				kind: "status",
				state: "disconnected",
				reason: "requested",
			}),
	};
}

it("matrix ordinary keys execute once per completed contact through mounted StripPanel and KeyRuntime", async () => {
	const f = await mountedMatrix();
	await f.matrix(0);
	await f.matrix(0);
	expect(f.effects).toEqual([]);
	await f.matrix(-1);
	await f.matrix(-1);
	expect(f.effects).toEqual(["text"]);
	await f.matrix(0);
	await f.matrix(-1);
	expect(f.effects).toEqual(["text", "text"]);
});

it("matrix hotkeys stay held across repeated reports and release once on empty", async () => {
	const f = await mountedMatrix();
	await f.matrix(1);
	await f.matrix(1);
	expect(f.effects).toEqual(["hold"]);
	await f.matrix(-1);
	await f.matrix(-1);
	expect(f.effects).toEqual(["hold", "release"]);
});

it("matrix A-to-B completes A before pressing B and cancels remaining contact on disconnect", async () => {
	const f = await mountedMatrix();
	await f.matrix(0);
	await f.matrix(1);
	expect(f.effects).toEqual(["text", "hold"]);
	expect(
		f.request.mock.calls.flatMap(([c]) =>
			c.type === "activate" ? [`${c.keyCode}:${c.kind}`] : [],
		),
	).toEqual(["1,1:down", "1,1:up", "1,2:down"]);
	await f.matrix(0);
	expect(f.effects).toEqual(["text", "hold", "release"]);
	await f.disconnect();
	await f.matrix(-1);
	expect(f.effects).toEqual(["text", "hold", "release"]);
});

it("matrix emoji uses the full strip handler exactly once on successful release", async () => {
	const f = await mountedMatrix();
	await f.matrix(2);
	await f.matrix(2);
	expect(f.emojiPress).not.toHaveBeenCalled();
	await f.matrix(-1);
	await f.matrix(-1);
	expect(f.emojiPress).toHaveBeenCalledExactlyOnceWith({
		profileId: "matrix-profile",
		pageId: "matrix-page",
		keyCode: "1,3",
		keyAction: 1,
	});
});

it("matrix replacement waits for a delayed down acknowledgement before releasing A and pressing B", async () => {
	const f = await mountedMatrix({ delayFirstDown: true });
	const edges = () =>
		f.request.mock.calls.flatMap(([c]) =>
			c.type === "activate" ? [`${c.keyCode}:${c.kind}`] : [],
		);
	await f.matrix(1, false);
	await f.clock(0);
	expect(f.effects).toEqual(["hold"]);
	await f.matrix(0, false);
	await f.clock(99);
	expect(edges()).toEqual(["1,2:down"]);
	expect(f.effects).toEqual(["hold"]);
	await f.clock(1);
	await f.matrix(-1);
	expect(edges()).toEqual(["1,2:down", "1,2:up", "1,1:down", "1,1:up"]);
	expect(f.effects).toEqual(["hold", "release", "text"]);
});
