import { Option, Schema } from "effect";
import { expect, it } from "vitest";
import { editKeyLayout } from "./key-geometry.js";
import { createEmptyProfileKey, ProfileKey } from "./profile-contracts.js";
import { profileOverflow } from "./profile-invariants.js";

const tile = (
	keyCode: string,
	size: readonly [number, number] = [1, 1],
	locked = false,
): ProfileKey => {
	const empty = createEmptyProfileKey(keyCode);
	return {
		...empty,
		childrenName: Option.some("hotkey"),
		config: {
			...empty.config,
			type: "hotkey",
			size,
			actions: [{ type: "key", value: "a" }],
			...(locked
				? {
						basicEditableItems: Option.some({
							title: true,
							icon: true,
							grid: true,
							allowDelete: true,
							allowDrag: false,
						}),
					}
				: {}),
		},
	};
};
it("SCREEN-136/MGMT-070 confirms the anchor and every overlapping inward footprint before replacement", () => {
	const keys = [tile("1,8", [2, 1]), tile("2,8", [2, 1])];
	const next = tile("2,8", [2, 2]);
	expect(editKeyLayout(keys, next, { placement: true })).toEqual({
		_tag: "confirmation",
		keyCodes: ["1,8", "2,8"],
	});
	expect(
		editKeyLayout(keys, next, { placement: true, replaceOverlaps: true }),
	).toEqual({ _tag: "ready", keys: [next] });
	expect(keys[0]?.keyCode).toBe("1,8");
});
it("SCREEN-136/MGMT-070 cannot confirm away a covered tile lock", () => {
	const locked = tile("1,8", [2, 1], true);
	expect(
		editKeyLayout([locked], tile("1,7"), {
			placement: true,
			replaceOverlaps: true,
		})._tag,
	).toBe("rejected");
});
it("SCREEN-137/MGMT-074 rejects invalid anchors, different spans and partial overlaps without changing keys", () => {
	const keys = [tile("1,1", [2, 1]), tile("1,4", [2, 1]), tile("2,8")];
	const before = keys.map((key) => Schema.encodeSync(ProfileKey)(key));
	for (const destination of ["0,1", "1,9", "3,1", "1,3", "2,8"])
		expect(
			editKeyLayout(keys, keys[0] ?? tile("1,1"), { destination })._tag,
		).toBe("rejected");
	expect(keys.map((key) => Schema.encodeSync(ProfileKey)(key))).toEqual(before);
});
it("SCREEN-139/MGMT-111 detects colliding and forced spans before decoding, while accepting inward edges", () => {
	const raw = [
		Schema.encodeSync(ProfileKey)(tile("1,8", [2, 1])),
		Schema.encodeSync(ProfileKey)(tile("2,8")),
	];
	expect(profileOverflow(raw)).toEqual([]);
	expect(
		profileOverflow([
			{ ...raw[0], config: { ...raw[0]?.config, type: "playAudio" } },
			raw[1],
		]),
	).toHaveLength(2);
});
