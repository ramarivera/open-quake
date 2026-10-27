import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Option, TestClock } from "effect";
import { QuakeDevice } from "@open-quake/device";
import { makeFakeHardwareTransport } from "@open-quake/device/hardware/fake";
import { HardwareControls } from "../../../../../packages/device/src/hardware/hardware-service";
import { executeHardwareKey } from "../../../../../packages/device/src/hardware/hardware-actions";
import { createActionDraft } from "../../../../../packages/device/src/actions/action-registry";
import { HardwareKeyConfig } from "../../../../../packages/device/src/hardware/hardware-actions";
import { Schema } from "effect";
import { sharedLighting } from "./qmk-lighting";
import { LightingService } from "../../../../../packages/device/src/lighting/lighting-service";
import { hostKeyboardAdapter } from "./host-keyboard";
import { linuxKeyboardPort } from "./host-keyboard-linux";
import { viaPermissionBroker } from "./via-permissions";

const setup = Effect.gen(function* () {
    const fake = yield* makeFakeHardwareTransport({serial: "A"});
    const device = yield* QuakeDevice.pipe(Effect.provide(QuakeDevice.DefaultWithoutDependencies.pipe(Layer.provide(fake.layer))));
    const connection = yield* device.connect();
    const controls = yield* HardwareControls.pipe(Effect.provide(HardwareControls.Default));
    const session = yield* controls.create(connection, {serial: "A", session: "a1"});
    yield* session.refresh();
    return {fake, session};
});
it.scoped("saved buzzer/mic/game mode keys execute real registry configs with serial guards", () => Effect.gen(function* () {
    const {session, fake} = yield* setup;
    for(const type of ["buzzer", "mic", "gameMode"] as const) {
        const config = Schema.decodeUnknownSync(HardwareKeyConfig)(createActionDraft(type));
        yield* executeHardwareKey(config, session, "A");
    }
    expect(yield* session.snapshot()).toMatchObject({mic: false, inputMode: "host", preferences: {buzzerEnabled: false}});
    const count = (yield* fake.writes).length;
    const wrong = yield* executeHardwareKey(Schema.decodeUnknownSync(HardwareKeyConfig)(createActionDraft("mic")), session, "B").pipe(Effect.either);
    expect(wrong._tag).toBe("Left");
    expect(yield* fake.writes).toHaveLength(count);
}));
it.scoped("QMK lighting reads/applies/saves through the existing one handle, then hardware delivery resumes", () => Effect.gen(function* () {
    const {session, fake} = yield* setup;
    yield* Effect.gen(function* () {
        const lighting = yield* LightingService;
        const target = {serial: "A", session: "a1"};
        const selected = yield* lighting.select(target);
        expect(selected.applied).toContainEqual({field: "brightness", value: 128});
        yield* lighting.setDesired(target, {field: "brightness", value: 200});
        expect((yield* lighting.flush(target)).applied).toContainEqual({field: "brightness", value: 200});
        expect((yield* lighting.save(target)).saveStatus).toBe("saved");
        expect((yield* lighting.select({serial: "B", session: "a1"}).pipe(Effect.either))._tag).toBe("Left");
        yield* session.toggleMic();
        expect((yield* session.snapshot()).mic).toBe(false);
        expect(yield* fake.opens).toBe(1);
    }).pipe(Effect.provide(sharedLighting(() => [session])));
}));
it.scoped("Linux uinput host chords release in reverse order on cancellation and reject permissions", () => Effect.gen(function* () {
    const ioctls: number[] = [], writes: Buffer[] = [], closed: number[] = [];
    const linux = linuxKeyboardPort({open: () => 10, ioctl: (_fd, op) => {ioctls.push(op);}, write: (_fd, bytes) => {writes.push(bytes);}, close: (fd) => {closed.push(fd);}});
    const keyboard = hostKeyboardAdapter({...linux, code: (usage) => usage});
    const pressing = yield* keyboard.pressChord("control+a").pipe(Effect.fork);
    yield* TestClock.adjust(10);
    yield* Fiber.interrupt(pressing);
    expect(writes.map((b) => [b.readUInt16LE(18), b.readInt32LE(20)])).toEqual([[29,1],[30,1],[30,0],[29,0]]);
    expect(writes.every((b) => b.length === 48 && b.readUInt16LE(40) === 0)).toBe(true);
    linux.close();
    expect(ioctls).toContain(0x5501);
    expect(ioctls.at(-1)).toBe(0x5502);
    expect(closed).toEqual([10]);
    const denied = hostKeyboardAdapter({available: () => false, post: () => {throw new Error("must not post");}});
    const result = yield* denied.pressChord("a").pipe(Effect.either);
    expect(result._tag === "Left" && result.left.code).toBe("QUAKE.ACTION.HOST_FAILED");
}));
it("VIA selects only exact origin/serial/collection and awaits exclusive release", async () => {
    const d = {deviceId: "raw", serialNumber: "A", vendorId: 0x4158, productId: 0x514b, collections: [{usagePage: 0xff60, usage: 0x61}]};
    let release = 0, resumed = 0;
    const broker = viaPermissionBroker({origin: "http://localhost:3010", selectedSerial: () => "A", release: async () => {release++; return async () => {resumed++;};}});
    for (const device of [{...d, vendorId: 0x5012}, {...d, serialNumber: "B"}, {...d, collections: [{usagePage:1,usage:6}]}]) expect(await broker.select("http://localhost:3010", [device])).toBe("");
    expect(await broker.select("https://foreign.test", [d])).toBe("");
    expect(release).toBe(0);
    expect(await broker.select("http://localhost:3010", [d])).toBe("raw");
    expect(broker.permitted("http://localhost:3010", d)).toBe(true);
    expect(await broker.select("http://localhost:3010", [d])).toBe("");
    await broker.resume(); expect(resumed).toBe(1);
    expect(broker.permitted("http://localhost:3010", d)).toBe(false);
});
