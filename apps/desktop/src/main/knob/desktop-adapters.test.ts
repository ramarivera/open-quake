import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { KnobModel } from "../../../../../packages/device/src/knob/model/service.js";
import {
	type EncodedProfileEnvelope,
	ProfileEnvelope,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { desktopKnobAdapters } from "./desktop-adapters";
import { makeKnobRuntime } from "./index";
import { canRequestKnob } from "./permissions";

const source = (): EncodedProfileEnvelope => ({
	schemaVersion: 1,
	profiles: [
		{
			id: "grid",
			name: "Workspace",
			revision: 0,
			pages: [{ id: "page", keys: [] }],
		},
		{
			id: "colorful",
			name: "Colorful Screen",
			revision: 0,
			pages: [{ id: "wallpaper", keys: [] }],
			compatibility: { name: "5,Colorful Screen", resourceId: "1-4" },
		},
	],
	activeByDevice: {},
});

describe("desktop knob integration", () => {
	it.effect(
		"commits actual local profile selection and passes voice generations without slot dispatch",
		() =>
			Effect.gen(function* () {
				let committed = source();
				let writes = 0;
				const voices: string[] = [];
				const adapter = desktopKnobAdapters(
					"/unused",
					{
						voice: (input) =>
							Effect.sync(() => {
								voices.push(`${input.action}:${input.generation}`);
							}),
					},
					{
						read: () => Promise.resolve(committed),
						write: (next) => {
							committed = next;
							writes++;
							return Promise.resolve();
						},
					},
				);
				const runtime = makeKnobRuntime(adapter.ports);
				yield* Effect.acquireUseRelease(
					Effect.succeed(runtime),
					() =>
						Effect.promise(async () => {
							await runtime.runPromise(
								adapter.load.pipe(Effect.flatMap(KnobModel.configure)),
							);
							const send = async (code: number): Promise<void> => {
								const snapshot = await runtime.runPromise(KnobModel.snapshot());
								await runtime.runPromise(
									KnobModel.dispatch({
										_tag: "Key",
										sessionId: snapshot.context.session.sessionId,
										code,
									}),
								);
							};
							await send(5);
							await send(255);
							await send(1);
							await send(2);
							expect(voices).toEqual([
								"holdStart:1",
								"release:1",
								"interrupt:1",
							]);
							expect(writes).toBe(1);
							expect(committed.activeByDevice["desktop-preview"]).toEqual({
								profileId: "colorful",
								pageId: "wallpaper",
							});
							expect(
								Schema.is(ProfileEnvelope)(
									Schema.decodeUnknownSync(ProfileEnvelope)(committed),
								),
							).toBe(true);
							await send(2);
							expect(writes).toBe(1);
						}),
					() => Effect.promise(() => runtime.dispose()),
				);
			}),
	);
	it("accepts only app-document panel mutations and never accepts firmware events from renderer", () => {
		const renderer = "file:///app/index.html";
		const input = { _tag: "Page", sessionId: "session", delta: 1 };
		expect(
			canRequestKnob(`${renderer}?surface=management`, renderer, input, true),
		).toBe(true);
		expect(
			canRequestKnob(`${renderer}?surface=panel`, renderer, input, false),
		).toBe(false);
		expect(
			canRequestKnob(
				"https://attacker.test/app/index.html",
				renderer,
				input,
				true,
			),
		).toBe(false);
		expect(canRequestKnob(renderer, renderer, { _tag: "Read" }, false)).toBe(
			true,
		);
		for (const code of [1, 2, 5, 255])
			expect(
				canRequestKnob(
					renderer,
					renderer,
					{ _tag: "Key", sessionId: "session", code },
					true,
				),
			).toBe(false);
	});
});
