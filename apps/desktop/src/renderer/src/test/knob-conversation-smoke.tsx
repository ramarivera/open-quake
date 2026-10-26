import { ManagedRuntime } from "effect";
import { act } from "react";
import { KnobModel } from "../../../../../../packages/device/src/knob/model/service";
import {
	dkClawProfile,
	voiceFixtureEnvelope,
} from "../../../main/test/voice-fixtures";
import type { KnobModelSnapshot } from "../../../shared/knob-contracts";
import type { VoiceSurfaceEvent } from "../../../shared/voice-surface";
import { delta, element, mount, started } from "../strip/render-test-fixtures";
import { StripPanel } from "../strip/StripPanel";

const nativeRequire: NodeJS.Require = globalThis.require;
const assert: typeof import("node:assert/strict") =
	nativeRequire("node:assert/strict");
export async function knobConversationSmoke() {
	const runtime = ManagedRuntime.make(KnobModel.Default);
	const subscribers = new Set<(value: unknown) => void>();
	let receive: (event: unknown) => void = () => {};
	let sent = 0;
	const model = await runtime.runPromise(KnobModel);
	await runtime.runPromise(
		model.configure({
			session: {
				deviceId: "QK",
				sessionId: "knob-fixture",
				profileId: dkClawProfile.id,
				revision: 0,
			},
			profiles: [
				{
					id: dkClawProfile.id,
					name: "Chat profile",
					colorful: false,
					thumbnail: { _tag: "missing" },
				},
				{
					id: "next",
					name: "Next profile",
					colorful: false,
					thumbnail: { _tag: "missing" },
				},
			],
			keys: [],
			player: false,
		}),
	);
	Object.defineProperty(window, "quakeKnob", {
		configurable: true,
		value: {
			request: async () => ({
				_tag: "success",
				snapshot: await runtime.runPromise(model.snapshot()),
			}),
			onSnapshot: (callback: (value: unknown) => void) => {
				subscribers.add(callback);
				return () => subscribers.delete(callback);
			},
		},
	});
	Object.defineProperty(window, "quakeProfiles", {
		configurable: true,
		value: {
			read: async () => ({
				_tag: "ready",
				envelope: voiceFixtureEnvelope(dkClawProfile, "QK"),
			}),
			onSnapshot: () => () => {},
		},
	});
	Object.defineProperty(window, "quakeVoice", {
		configurable: true,
		value: {
			onEvent: (callback: (event: unknown) => void) => {
				receive = callback;
				return () => {};
			},
			request: async () => {
				sent++;
				return { _tag: "ok" };
			},
		},
	});
	const screen = await mount(<StripPanel />);
	const send = async (event: VoiceSurfaceEvent) =>
		act(async () => {
			receive(event);
		});
	const rotate = async (delta: -1 | 1) => {
		await runtime.runPromise(
			model.dispatch({ _tag: "Rotate", sessionId: "knob-fixture", delta }),
		);
		const snapshot: KnobModelSnapshot = await runtime.runPromise(
			model.snapshot(),
		);
		await act(async () => {
			for (const receive of subscribers) receive(snapshot);
			await new Promise((resolve) => setTimeout(resolve, 30));
		});
		return snapshot;
	};
	try {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 30));
		});
		await send(started());
		await send(delta("retained conversation"));
		const text = element(".clawbot-messages").textContent,
			scroll = element(".clawbot-messages").scrollTop;
		const first = await rotate(1);
		assert.equal(first.selector.mode, "ring");
		assert(element(".knob-wheel"));
		assert.equal(element(".clawbot").getAttribute("data-wheel"), "true");
		assert.equal(
			getComputedStyle(element(".clawbot-input")).backdropFilter,
			"none",
		);
		assert.equal(getComputedStyle(element(".clawbot")).backdropFilter, "none");
		const next = await rotate(-1);
		assert.notEqual(next.selector.index, first.selector.index);
		assert.equal(element(".clawbot-messages").textContent, text);
		assert.equal(element(".clawbot-messages").scrollTop, scroll);
		assert.equal(sent, 0);
		await runtime.runPromise(
			model.dispatch({ _tag: "Dismiss", sessionId: "knob-fixture" }),
		);
		await act(async () => {
			const snapshot = await runtime.runPromise(model.snapshot());
			for (const receive of subscribers) receive(snapshot);
			await new Promise((resolve) => setTimeout(resolve, 30));
		});
		assert.equal(document.querySelector(".knob-wheel"), null);
		assert.equal(element(".clawbot").getAttribute("data-wheel"), null);
		return 1;
	} finally {
		await screen.unmount();
		await runtime.dispose();
		for (const name of ["quakeKnob", "quakeProfiles", "quakeVoice"])
			Reflect.deleteProperty(window, name);
	}
}
