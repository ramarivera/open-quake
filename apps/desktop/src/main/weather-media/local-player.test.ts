import { Effect, Schema } from "effect";
import { expect, it } from "vitest";
import {
	createEmptyProfileKey,
	ProfileEnvelope,
	ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts";
import { isSystemPlayerKey } from "./key-actions";
import { committedLocalPlayer } from "./local-player";

it("KNOB-096 WIDGETS-111 committed local reads reject stale/other device identities and retain saved source through serialization", async () => {
	const empty = Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1"));
	const key = {
		...empty,
		childrenName: "playAudio",
		config: {
			...empty.config,
			type: "playAudio",
			actions: [
				{ type: "sound", value: "" },
				{ type: "audioAction", value: 0 },
				{ type: "musicSource", value: "local" },
			],
		},
	};
	const encoded = {
		schemaVersion: 1,
		profiles: [
			{ id: "p", name: "P", revision: 1, pages: [{ id: "one", keys: [key] }] },
		],
		activeByDevice: { device: { profileId: "p", pageId: "one" } },
	};
	const envelope = Schema.decodeUnknownSync(ProfileEnvelope)(
		JSON.parse(JSON.stringify(encoded)),
	);
	const decoded = envelope.profiles[0].pages[0]?.keys[0];
	if (!decoded) throw new Error("key missing");
	expect(isSystemPlayerKey(decoded)).toBe(false);
	const calls: unknown[] = [];
	const port = committedLocalPlayer(
		async () => envelope,
		async (key, target) => {
			calls.push([key, target]);
			return {
				revision: 99,
				state: "ready",
				title: "local",
				trackIndex: 0,
				total: 1,
				positionMs: 0,
				errorCode: null,
			};
		},
	);
	const target = {
		deviceId: "device",
		profileId: "p",
		pageId: "one",
		keyCode: "1,1",
		revision: 1,
	};
	expect((await Effect.runPromise(port.read(target))).state).toBe("ready");
	for (const invalid of [
		{ ...target, revision: 0 },
		{ ...target, deviceId: "other" },
		{ ...target, pageId: "other" },
	])
		expect((await Effect.runPromise(port.read(invalid))).state).toBe(
			"unconfigured",
		);
	expect(calls).toHaveLength(1);
	const system = {
		...decoded,
		config: {
			...decoded.config,
			actions: decoded.config.actions.map((a) =>
				a.type === "musicSource" ? { ...a, value: "system" } : a,
			),
		},
	};
	expect(isSystemPlayerKey(system)).toBe(true);
});
