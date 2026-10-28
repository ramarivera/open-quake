import { Option, Schema } from "effect";
import { expect, it } from "vitest";
import { editKeyLayout } from "./key-geometry.js";
import {
	createEmptyProfileKey,
	ProfileKey,
	ProfilePage,
} from "./profile-contracts.js";
import { inspectProfileImport } from "./profile-import.js";
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
			type: locked ? "meetingRecordMark" : "hotkey",
			size,
			actions: [{ type: "key", value: "a" }],
			...(locked
				? {
						basicEditableItems: Option.some({
							title: true,
							icon: true,
							grid: true,
							allowDelete: false,
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

it("MGMT-111 counts normalized keys rather than legacy null sentinels at the page limit", () => {
	const keys = Array.from({ length: 16 }, (_, index) =>
		Schema.encodeSync(ProfileKey)(
			tile(`${Math.floor(index / 8) + 1},${(index % 8) + 1}`),
		),
	);
	const legacy = [...keys, null];
	const profile = {
		id: "import",
		name: "Imported",
		revision: 0,
		pages: [{ id: "page", keys: legacy }],
	};
	for (const source of [legacy, profile]) {
		expect(profileOverflow(source)).toEqual([]);
		const report = inspectProfileImport(source);
		expect(report.profile?.pages[0].keys).toHaveLength(16);
		expect(report.diagnostics).toContainEqual({
			code: "legacy-sentinel",
			path: "pages.0.keys.16",
			blocking: false,
		});
	}
	expect(profileOverflow([...legacy, keys[0]])).toHaveLength(17);
});
it("moves a wide tile within its own footprint instead of resolving back to its anchor", () => {
	const wide = tile("1,1", [2, 1]);
	const result = editKeyLayout([wide], wide, { destination: "1,2" });
	expect(result._tag).toBe("ready");
	if (result._tag === "ready")
		expect(result.keys.map((key) => key.keyCode)).toContain("1,2");
});

for (const destination of ["1,4", "1,5"]) {
	it(`rejects moving onto structural anchor/covered cell ${destination} with locked feedback`, () => {
		const source = tile("1,1");
		const target = { ...tile("1,4", [2, 1], true) };
		const protectedTile = target;
		const keys = [source, protectedTile];
		expect(
			editKeyLayout(keys, source, { destination, replaceOverlaps: true }),
		).toEqual({ _tag: "rejected", reason: "locked" });
		expect(keys[1]).toBe(protectedTile);
	});
}

it("a saved Vivid page with another visible key still decodes", () => {
	const vivid = {
		...tile("1,1"),
		config: { ...tile("1,1").config, type: "colorfulScreen" },
	};
	// The storage reader decodes pages with this schema; failing it reseeds profiles.
	const keys = [vivid, tile("1,2")].map((key) =>
		Schema.encodeSync(ProfileKey)(key),
	);
	expect(() =>
		Schema.decodeUnknownSync(ProfilePage)({ id: "vivid", keys }),
	).not.toThrow();
	expect(profileOverflow(keys)).toEqual([]);
});

it("a hidden structural swap target cannot be displaced", () => {
	const source = tile("1,1");
	const target = tile("1,2", [1, 1], true);
	const hidden = { ...target, config: { ...target.config, display: false } };
	expect(
		editKeyLayout([source, hidden], source, { destination: "1,2" }),
	).toEqual({ _tag: "rejected", reason: "locked" });
});

it("rejects a hidden source's move into a displayed wide tile's covered cell", () => {
	const base = tile("1,1");
	const hidden = { ...base, config: { ...base.config, display: false } };
	expect(
		editKeyLayout([hidden, tile("1,4", [2, 1])], hidden, {
			destination: "1,5",
		}),
	).toEqual({ _tag: "rejected", reason: "spaceNotEnough" });
});

it("reports structural protection when a resized swap displaces a target onto a protected tile", () => {
	const source = tile("1,1");
	const target = tile("1,4", [2, 2]);
	const protectedTile = tile("1,2", [1, 1], true);
	expect(
		editKeyLayout(
			[source, target, protectedTile],
			{ ...source, config: { ...source.config, size: [2, 2] } },
			{ destination: "1,4" },
		),
	).toEqual({ _tag: "rejected", reason: "locked" });
});
