import type { HardwareSession } from "@open-quake/device";
import { Effect, Schema } from "effect";
import {
	HardwareRequest,
	type HardwareResponse,
	type QmkBinding,
} from "../../shared/hardware-contracts";

const bindings = new Map<string, readonly (typeof QmkBinding.Type)[]>();
/** Only a current bus-owned session can supply a QMK handle. */
export function qmkRequest(
	input: unknown,
	sessions: readonly HardwareSession[],
): Effect.Effect<HardwareResponse> {
	return Effect.gen(function* () {
		const command = yield* Schema.decodeUnknown(HardwareRequest)(input).pipe(
			Effect.orDie,
		);
		const targets: { serial: string; session: string }[] = [];
		for (const owner of sessions) {
			const state = yield* owner.snapshot();
			if (state.available)
				targets.push({ serial: state.serial, session: state.session });
		}
		if (command._tag === "qmkTargets")
			return { _tag: "qmkTargets" as const, targets };
		for (const session of bindings.keys())
			if (!targets.some((target) => target.session === session))
				bindings.delete(session);
		if (command._tag !== "qmk" && command._tag !== "qmkBindings")
			return {
				_tag: "failure" as const,
				code: "QUAKE.HARDWARE.INVALID_REQUEST",
			};
		for (const owner of sessions) {
			const state = yield* owner.snapshot();
			if (
				state.serial !== command.serial ||
				state.session !== command.session ||
				!state.available
			)
				continue;
			if (command._tag === "qmkBindings")
				return {
					_tag: "qmkBindings" as const,
					bindings: bindings.get(state.session) ?? [],
				};
			const values = yield* owner.qmk(command.operations);
			const next = [...(bindings.get(state.session) ?? [])];
			command.operations.forEach((operation, index) => {
				if (operation._tag !== "probe") return;
				const result = values[index] ?? [];
				const length = operation.values.length;
				const binding = {
					name: operation.name,
					prefix: operation.prefix,
					before: result.slice(0, length),
					after: result.slice(length, length * 2),
					changed: result[length * 2] === 1,
				};
				const prior = next.findIndex((item) => item.name === operation.name);
				if (prior >= 0) next[prior] = binding;
				else next.push(binding);
			});
			bindings.set(state.session, next);
			return { _tag: "qmk" as const, values };
		}
		return { _tag: "failure" as const, code: "QUAKE.HARDWARE.STALE_SESSION" };
	}).pipe(
		Effect.catchAll((error) =>
			Effect.succeed({ _tag: "failure" as const, code: error.code }),
		),
	);
}
