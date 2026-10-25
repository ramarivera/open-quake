import { Effect, Layer, Schema } from "effect";
import { expect, it, vi } from "vitest";
import { HostActionFailed } from "../../../../../packages/device/src/actions/action-errors";
import { KeyRuntime } from "../../../../../packages/device/src/actions/key-runtime-service";
import {
	createEmptyProfileKey,
	ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts";
import {
	ProfileRepository,
	profileStorageLayer,
} from "../../../../../packages/device/src/profiles/profile-repository";
import { ProfileService } from "../../../../../packages/device/src/profiles/profile-service";
import { HaNetworkFailed } from "../../../../../packages/edge/src/channels/integration-errors";
import type { HaKey } from "../../../../../packages/edge/src/home-assistant/ha-contracts";
import { desktopKeyRuntimePort } from "../key-library/runtime-port";
import { ManagementProfileContractsLive } from "../management/profile-contracts";
import { integrationKeyAction } from "./key-action";

vi.mock("electron", () => ({ clipboard: {}, shell: {} }));
const config: HaKey = {
	entity_id: "input_boolean.acceptance",
	service: "toggle",
	service_data: {},
	custom_display_type: "default",
	custom_display_settings: { fontSize: 20 },
	custom_display_detail: [{ displayItemKey: "state", displayAlias: "State" }],
};
function key() {
	const empty = Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1"));
	return {
		...empty,
		childrenName: "homeAssistant",
		config: {
			...empty.config,
			type: "homeAssistant",
			display: true,
			actions: [{ type: "configData", value: JSON.stringify(config) }],
		},
	};
}
function layer(
	input: ReturnType<typeof key>,
	execute: (key: HaKey) => Promise<void>,
	mock = false,
) {
	const profiles = ProfileService.DefaultWithoutDependencies.pipe(
		Layer.provide(
			ProfileRepository.DefaultWithoutDependencies.pipe(
				Layer.provide(
					profileStorageLayer({
						read: async () => ({
							schemaVersion: 1,
							profiles: [
								{
									id: "p",
									name: "Synthetic",
									revision: 3,
									pages: [{ id: "one", keys: [input] }],
								},
							],
							activeByDevice: { device: { profileId: "p", pageId: "one" } },
						}),
						write: async () => {},
					}),
				),
				Layer.provide(ManagementProfileContractsLive),
			),
		),
	);
	return KeyRuntime.DefaultWithoutDependencies.pipe(
		Layer.provide(
			desktopKeyRuntimePort(
				() => undefined,
				() => {},
				mock,
				integrationKeyAction(execute),
			).pipe(Layer.provide(profiles)),
		),
	);
}
const expected = { profileId: "p", pageId: "one", revision: 3 };
it("executes committed HA keys once per press and bypasses the generic action rejection", async () => {
	const execute = vi.fn(async (_key: HaKey) => {});
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* KeyRuntime.activate("device", "1,1", "press", expected);
			yield* KeyRuntime.activate("device", "1,1", "press", expected);
			expect(execute).toHaveBeenCalledExactlyOnceWith(config);
			yield* KeyRuntime.activate("device", "1,1", "release", expected);
			yield* KeyRuntime.activate("device", "1,1", "press", expected);
		}).pipe(Effect.provide(layer(key(), execute)), Effect.scoped),
	);
	expect(execute).toHaveBeenCalledTimes(2);
});
it.each(["revision", "profile", "page", "hidden", "quarantined"] as const)(
	"keeps the %s guard ahead of integration execution",
	async (guard) => {
		const execute = vi.fn(async (_key: HaKey) => {});
		const input = key();
		const wanted = { ...expected };
		if (guard === "revision") wanted.revision = 2;
		if (guard === "profile") wanted.profileId = "other";
		if (guard === "page") wanted.pageId = "other";
		if (guard === "hidden") input.config.display = false;
		const candidate =
			guard === "quarantined"
				? { ...input, compatibility: { unsupported: true } }
				: input;
		await Effect.runPromise(
			KeyRuntime.activate("device", "1,1", "press", wanted).pipe(
				Effect.provide(layer(candidate, execute)),
				Effect.scoped,
			),
		);
		expect(execute).not.toHaveBeenCalled();
	},
);
it("preserves a failed HA dependency as the typed host error cause", async () => {
	const cause = new HaNetworkFailed(
		new Error("acceptance-private-token-value"),
	);
	const execute = vi.fn(async (_key: HaKey) => {
		throw cause;
	});
	const error = await Effect.runPromise(
		KeyRuntime.activate("device", "1,1", "press", expected).pipe(
			Effect.flip,
			Effect.provide(layer(key(), execute)),
			Effect.scoped,
		),
	);
	expect(error).toBeInstanceOf(HostActionFailed);
	expect(error.originalCause).toBe(cause);
	expect(JSON.stringify(error)).not.toContain("acceptance-private-token-value");
});
it("keeps mock-device runs from executing the external integration", async () => {
	const execute = vi.fn(async (_key: HaKey) => {});
	await Effect.runPromise(
		KeyRuntime.activate("device", "1,1", "press", expected).pipe(
			Effect.either,
			Effect.provide(layer(key(), execute, true)),
			Effect.scoped,
		),
	);
	expect(execute).not.toHaveBeenCalled();
});
it("leaves unrelated key types with their existing runtime", async () => {
	const execute = vi.fn(async (_key: HaKey) => {});
	expect(
		await integrationKeyAction(execute)(createEmptyProfileKey("1,1")),
	).toBe(false);
	const malformed = key();
	malformed.config.actions = [];
	await expect(
		integrationKeyAction(execute)(
			Schema.decodeUnknownSync(ProfileKey)(malformed),
		),
	).rejects.toMatchObject({ _tag: "InputRejected" });
	expect(execute).not.toHaveBeenCalled();
});
