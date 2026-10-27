import type { HardwareSession } from "@open-quake/device";
import { Effect, Schema } from "effect";
import { HardwareRequest, type HardwareResponse } from "../../shared/hardware-contracts";

/** Only a current bus-owned session can supply a QMK handle. */
export function qmkRequest(input: unknown, sessions: readonly HardwareSession[]): Effect.Effect<HardwareResponse> {
    return Effect.gen(function* () {
        const command = yield* Schema.decodeUnknown(HardwareRequest)(input).pipe(Effect.orDie);
        const targets: {serial: string; session: string}[] = [];
        for (const owner of sessions) {
            const state = yield* owner.snapshot();
            if (state.available) targets.push({serial: state.serial, session: state.session});
        }
        if (command._tag === "qmkTargets") return {_tag: "qmkTargets" as const, targets};
        if (command._tag !== "qmk") return {_tag: "failure" as const, code: "QUAKE.HARDWARE.INVALID_REQUEST"};
        for (const owner of sessions) {
            const state = yield* owner.snapshot();
            if (state.serial !== command.serial || state.session !== command.session || !state.available) continue;
            const values = yield* owner.qmk(command.operations);
            return {_tag: "qmk" as const, values};
        }
        return {_tag: "failure" as const, code: "QUAKE.HARDWARE.STALE_SESSION"};
    }).pipe(Effect.catchAll((error) => Effect.succeed({_tag: "failure" as const, code: error.code})));
}
