import { Effect, Either, ManagedRuntime, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import { ProfileEnvelope } from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { ProfileService } from "../../../../../packages/device/src/profiles/profile-service.js";
import { ProfilesLive } from "../profiles/profile-ipc";
import { desktopKnobAdapters } from "./desktop-adapters";
import { knobProfileBinding } from "./profile-binding";

vi.mock("electron", () => ({ app: {}, nativeImage: {}, ipcMain: {} }));
const encoded = {
	schemaVersion: 1,
	profiles: [
		{ id: "first", name: "First", revision: 0, pages: [{ id: "a", keys: [] }] },
		{
			id: "second",
			name: "Second",
			revision: 0,
			pages: [
				{ id: "b", keys: [] },
				{ id: "c", keys: [] },
			],
		},
	],
	activeByDevice: {
		"desktop-preview": { profileId: "first", pageId: "a" },
		"serial-private": { profileId: "second", pageId: "c" },
	},
};
describe("production knob profile identity", () => {
	it("reads the device's own profile/page and persists only that device in isolated fallback", async () => {
		let saved: unknown = encoded;
		let serial = "serial-private";
		const adapter = desktopKnobAdapters(
			"/unused",
			{ deviceId: () => serial },
			{
				read: async () => saved,
				write: async (value) => {
					saved = value;
				},
			},
		);
		const initial = await Effect.runPromise(adapter.load);
		expect(initial.session).toMatchObject({
			deviceId: serial,
			profileId: "second",
		});
		expect(initial.pageId).toBe("c");
		const selected = await Effect.runPromise(
			adapter.ports.selectProfile("first"),
		);
		expect(selected.session.deviceId).toBe(serial);
		expect(
			Schema.decodeUnknownSync(ProfileEnvelope)(saved).activeByDevice,
		).toEqual({
			"desktop-preview": { profileId: "first", pageId: "a" },
			"serial-private": { profileId: "first", pageId: "a" },
		});
		serial = "replacement";
		const stale = await Effect.runPromise(
			adapter.ports.selectProfile("second").pipe(Effect.either),
		);
		expect(Either.isLeft(stale) && stale.left.code).toBe(
			"QUAKE.KNOB.SESSION_STALE",
		);
	});
	it("keeps the supplied manager selector as sole owner and retains typed persistence failures", async () => {
		const source = Object.assign(new Error("/private/path token=secret"), {
			code: "EACCES",
		});
		const runtime = ManagedRuntime.make(
			ProfilesLive({
				read: async () => encoded,
				write: async () => {
					throw source;
				},
			}),
		);
		const select = vi.fn((id: string) =>
			runtime.runPromise(
				ProfileService.selectProfile({
					deviceId: "serial-private",
					profileId: id,
				}),
			),
		);
		try {
			const adapter = desktopKnobAdapters("/unused", {
				deviceId: () => "serial-private",
				profiles: knobProfileBinding(runtime, select),
			});
			await Effect.runPromise(adapter.load);
			const result = await Effect.runPromise(
				adapter.ports.selectProfile("first").pipe(Effect.either),
			);
			expect(select).toHaveBeenCalledExactlyOnceWith(
				"first",
				expect.objectContaining({
					deviceId: "serial-private",
					isCurrent: expect.any(Function),
				}),
			);
			expect(Either.isLeft(result)).toBe(true);
			if (Either.isLeft(result)) {
				expect(result.left).toMatchObject({
					code: "QUAKE.KNOB.DISPATCH_FAILED",
					originalCause: { _tag: "ProfileWriteFailed", originalCause: source },
				});
				expect(JSON.stringify(result.left)).not.toMatch(/private|secret/);
			}
			expect((await Effect.runPromise(adapter.load)).session.profileId).toBe(
				"second",
			);
		} finally {
			await runtime.dispose();
		}
	});
});
