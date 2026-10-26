import { Layer, ManagedRuntime, Schema } from "effect";
import { expect, it, vi } from "vitest";
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
import { desktopKeyRuntimePort } from "../key-library/runtime-port";
import { ManagementProfileContractsLive } from "../management/profile-contracts";
import { obsKeyAction } from "./key-action";

vi.mock("electron", () => ({ clipboard: {}, shell: {} }));
it("committed key runtime dispatches OBS once, deduplicates held input and rejects stale snapshots", async () => {
	const empty = Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1"));
	const key = {
		...empty,
		childrenName: "obsStream",
		config: {
			...empty.config,
			type: "obsStream",
			display: true,
			actions: [{ type: "configData", value: '{"mode":"toggle"}' }],
		},
	};
	const execute = vi.fn(async (_command: unknown, _signal: AbortSignal) => {});
	const profiles = ProfileService.DefaultWithoutDependencies.pipe(
		Layer.provideMerge(
			ProfileRepository.DefaultWithoutDependencies.pipe(
				Layer.provide(
					profileStorageLayer({
						read: async () => ({
							schemaVersion: 1,
							profiles: [
								{
									id: "p",
									name: "OBS",
									revision: 1,
									pages: [{ id: "one", keys: [key] }],
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
	const runtime = ManagedRuntime.make(
		KeyRuntime.DefaultWithoutDependencies.pipe(
			Layer.provide(
				desktopKeyRuntimePort(
					() => undefined,
					() => {},
					false,
					obsKeyAction(execute),
				),
			),
			Layer.provide(profiles),
		),
	);
	try {
		const press = KeyRuntime.activate("device", "1,1", "press", {
			profileId: "p",
			pageId: "one",
			revision: 1,
		});
		await runtime.runPromise(press);
		await runtime.runPromise(press);
		expect(execute).toHaveBeenCalledTimes(1);
		expect(execute.mock.calls[0]?.[0]).toEqual({
			type: "obsStream",
			settings: { mode: "toggle" },
		});
		await runtime.runPromise(KeyRuntime.activate("device", "1,1", "release"));
		await runtime.runPromise(
			KeyRuntime.activate("device", "1,1", "press", {
				profileId: "p",
				pageId: "one",
				revision: 0,
			}),
		);
		expect(execute).toHaveBeenCalledTimes(1);
	} finally {
		await runtime.dispose();
	}
});
it("foreign and malformed keys cannot dispatch OBS", async () => {
	const execute = vi.fn(async (_command: unknown, _signal: AbortSignal) => {});
	const action = obsKeyAction(execute);
	const empty = createEmptyProfileKey("1,1");
	expect(await action(empty, new AbortController().signal)).toBe(false);
	const malformed = {
		...empty,
		config: {
			...empty.config,
			type: "obsScene",
			actions: [{ type: "configData", value: "{}" }],
		},
	};
	await expect(
		action(malformed, new AbortController().signal),
	).rejects.toMatchObject({ code: "OBS.CONFIG.REJECTED" });
	expect(execute).not.toHaveBeenCalled();
});
