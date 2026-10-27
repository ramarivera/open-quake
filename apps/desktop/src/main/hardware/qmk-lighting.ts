import type { HardwareSession } from "@open-quake/device";
import { Effect, Layer, Option } from "effect";
import { LightingDevice, type LightingRegistration } from "../../../../../packages/device/src/lighting/lighting-device";
import { LightingTargetUnavailable, LightingIoFailed, LightingReadFailed } from "../../../../../packages/device/src/lighting/lighting-errors";
import { LightingService } from "../../../../../packages/device/src/lighting/lighting-service";
import type { LightingChange, LightingTarget } from "../../../../../packages/device/src/lighting/lighting-contracts";
import { valueFits } from "../../../../../packages/device/src/lighting/lighting-invariants";

/** Adapt the existing lighting conductor to the bus-owned handle. Never NodeHidLive.open. */
export function sharedLighting(sessions: () => readonly HardwareSession[]) {
    const owner = (target: LightingTarget) => Effect.gen(function* () {
        for (const session of sessions()) {
            const state = yield* session.snapshot();
            if (state.available && state.serial === target.serial && state.session === target.session) return session;
        }
        return yield* new LightingTargetUnavailable();
    });
    const resolve = (target: LightingTarget) => Effect.gen(function* () {
        const session = yield* owner(target);
        const values = yield* session.qmk([{_tag: "protocol"}]).pipe(Effect.mapError((cause) => new LightingTargetUnavailable(cause)));
        const version = (values[0]?.[0] ?? 0) * 256 + (values[0]?.[1] ?? 0);
        const identity = {firmware: "QUAKE", protocolVersion: version};
        const evidence = {identity, basis: "source-qualified" as const};
        // Legacy values are recovered from QMKLightingService.js. v3 channels need their own qualification.
        return {
            info: {path: "shared-owner", vendorId: 0x4158, productId: 0x514b, usagePage: 0xff60, usage: 0x61},
            capabilities: {
                target, identity, transport: version < 11 ? "legacy" as const : "unavailable" as const,
                fields: version < 11 ? [
                    {field: "brightness" as const, valueId: 0x09 as const, readable: true, writable: true, range: {min: 0, max: 255}, evidence},
                    {field: "effectSpeed" as const, valueId: 0x0b as const, readable: true, writable: true, range: {min: 0, max: 255}, evidence},
                    {field: "color1" as const, valueId: 0x0c as const, readable: true, writable: true, hue: {min: 0, max: 255}, saturation: {min: 0, max: 255}, evidence},
                ] : [],
                save: version < 11 ? Option.some({evidence, completion: "ack-and-readback" as const}) : Option.none(),
            },
        } satisfies LightingRegistration;
    });
    const device = Layer.succeed(LightingDevice, new LightingDevice({
        resolve,
        open: (registration) => Effect.gen(function* () {
            const target = registration.capabilities.target;
            const exchange = (command: import("@open-quake/protocol").QmkCommand) => Effect.gen(function* () {
                const session = yield* owner(target);
                const operations = command.command === 1 ? [{_tag: "protocol" as const}] : command.command === 9 ? [{_tag: "save" as const, channel: command.channelId}] : command.command === 7 ? [{_tag: "set" as const, prefix: [command.lightingValue], values: command.values}] : [{_tag: "get" as const, prefix: [command.lightingValue], length: command.resultLength}];
                const values = yield* session.qmk(operations).pipe(Effect.mapError((cause) => new LightingIoFailed(cause)));
                if (command.command === 1) return {command: 1 as const, version: (values[0]?.[0] ?? 0) * 256 + (values[0]?.[1] ?? 0)};
                if (command.command === 8) return {command: 8 as const, lightingValue: command.lightingValue, values: values[0] ?? []};
                return {command: command.command, acknowledged: true as const};
            });
            return {
                capabilities: registration.capabilities,
                ended: Effect.forever(Effect.sleep(500).pipe(Effect.zipRight(owner(target)))).pipe(Effect.mapError((cause) => new LightingIoFailed(cause))),
                exchange,
                read: (cap) => Effect.gen(function* () {
                    const reply = yield* exchange({command: 8, lightingValue: cap.valueId, resultLength: cap.field === "color1" || cap.field === "color2" ? 2 : 1}).pipe(Effect.mapError((cause) => new LightingReadFailed(cause)));
                    if (reply.command !== 8) return yield* new LightingReadFailed(undefined);
                    const change: LightingChange = cap.field === "color1" || cap.field === "color2" ? {field: cap.field, value: {hue: reply.values[0] ?? -1, saturation: reply.values[1] ?? -1}} : {field: cap.field, value: reply.values[0] ?? -1};
                    if (!valueFits(cap, change)) return yield* new LightingReadFailed(undefined);
                    return change;
                }),
            };
        }),
    }));
    return LightingService.DefaultWithoutDependencies.pipe(Layer.provide(device));
}
