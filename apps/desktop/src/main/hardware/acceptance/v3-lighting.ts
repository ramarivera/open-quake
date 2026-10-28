import assert from "node:assert/strict";
import { Effect } from "effect";
import type { HardwareSession } from "../../../../../../packages/device/src/hardware/hardware-service.js";
import { restoring } from "./consumer.js";

// Source: recovered DeviceSettings.vue extractV3MenuCommands, RGB matrix channel3.
export const v3Fields = [
	{ field: "brightness", prefix: [3, 1], length: 1 },
	{ field: "effect", prefix: [3, 2], length: 1 },
	{ field: "effectSpeed", prefix: [3, 3], length: 1 },
	{ field: "color", prefix: [3, 4], length: 2 },
] as const;

/** Hardware-qualified speed probe. Other values remain read-only until their mapping is qualified. */
export const probeV3Lighting = (
	session: HardwareSession,
	mutations: boolean,
	restore?: (
		prefix: readonly number[],
		values: readonly number[],
	) => Effect.Effect<void, unknown, never>,
) =>
	Effect.gen(function* () {
		const originals = yield* session.qmk(
			v3Fields.map((row) => ({
				_tag: "get" as const,
				prefix: row.prefix,
				length: row.length,
			})),
		);
		assert.equal(originals.length, v3Fields.length);
		const rows: Array<{
			field: string;
			before: readonly number[];
			attempted: readonly number[];
			after: readonly number[];
			restored: boolean;
			mutated: boolean;
			applied: readonly number[];
			appliedMatches: boolean;
		}> = [];
		for (let index = 0; index < v3Fields.length; index++) {
			const row = v3Fields[index],
				original = originals[index];
			assert(row && original && original.length === row.length);
			// Native tests verified exact speed restoration; brightness/color are not byte-for-byte mappings.
			const mutate = mutations && row.field === "effectSpeed";
			const attempted = mutate
				? original.map((value) => (value + 31) % 256)
				: original;
			let applied: readonly number[] = original;
			if (mutate)
				yield* restoring(
					Effect.gen(function* () {
						yield* session.qmk([
							{ _tag: "set", prefix: row.prefix, values: attempted },
						]);
						const actual = yield* session.qmk([
							{ _tag: "get", prefix: row.prefix, length: row.length },
						]);
						applied = actual[0] ?? [];
						assert.deepEqual(
							applied,
							attempted,
							"V3 speed applied readback mismatch",
						);
					}),
					restore
						? restore(row.prefix, original)
						: session
								.qmk([
									{ _tag: "set", prefix: row.prefix, values: original },
									{ _tag: "get", prefix: row.prefix, length: row.length },
								])
								.pipe(
									Effect.tap((actual) =>
										Effect.sync(() =>
											assert.deepEqual(
												actual[1],
												original,
												"V3 speed restoration mismatch",
											),
										),
									),
									Effect.asVoid,
								),
				);
			const actual = yield* session.qmk([
				{ _tag: "get", prefix: row.prefix, length: row.length },
			]);
			assert.deepEqual(actual[0], original, "V3 original state changed");
			rows.push({
				field: row.field,
				before: original,
				attempted,
				after: actual[0] ?? [],
				restored: true,
				mutated: mutate,
				applied,
				appliedMatches: JSON.stringify(applied) === JSON.stringify(attempted),
			});
		}
		return rows;
	});
