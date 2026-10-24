import {
	Effect,
	Array as EffectArray,
	Layer,
	ManagedRuntime,
	Option,
	Schema,
} from "effect";
import { describe, expect, it } from "vitest";
import {
	createInitialProfileEnvelope,
	encodeProfileEnvelope,
	type ProfileEnvelope,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { ProfileDeliveryFailed } from "../../../../../packages/device/src/profiles/profile-errors.js";
import { installProfileCatalog } from "../../../../../packages/device/src/profiles/profile-manager-invariants.js";
import { ProfileManager } from "../../../../../packages/device/src/profiles/profile-manager-service.js";
import {
	ProfileRepository,
	profileStorageLayer,
} from "../../../../../packages/device/src/profiles/profile-repository.js";
import { ProfileService } from "../../../../../packages/device/src/profiles/profile-service.js";
import {
	ProfileSwitching,
	ProfileSwitchingPort,
} from "../../../../../packages/device/src/profiles/profile-switching-service.js";
import {
	type AgentState,
	type PanelProgress,
	Slots,
} from "../../../../../packages/edge/src/agents/agents-contracts.js";
import { initialAgentState } from "../../../../../packages/edge/src/agents/agents-invariants.js";
import {
	AgentPanelPort,
	AgentRuntimePort,
} from "../../../../../packages/edge/src/agents/agents-ports.js";
import { AgentStorage } from "../../../../../packages/edge/src/agents/agents-repository.js";
import { AgentsService } from "../../../../../packages/edge/src/agents/agents-service.js";
import { ManagementProfileContractsLive } from "../management/profile-contracts";
import { makeProfileController } from "../profiles/profile-controller";
import { agentProfileBinding } from "./profile-binding";

function fixture(
	active = "1-4",
	invalidSlot = false,
	composition: "canonical" | "repository-defaults" = "canonical",
) {
	let saved = encodeProfileEnvelope(
		installProfileCatalog(createInitialProfileEnvelope(), "darwin"),
	);
	let writes = 0;
	let failDelivery = 0;
	let deliveries = 0;
	let failProfileWrite = false;
	const repository =
		composition === "repository-defaults"
			? ProfileRepository.Default
			: ProfileRepository.DefaultWithoutDependencies;
	if (invalidSlot)
		saved = {
			...saved,
			profiles: EffectArray.map(saved.profiles, (p) =>
				p.id !== "1-8"
					? p
					: {
							...p,
							pages: EffectArray.map(p.pages, (page) => ({
								...page,
								keys: page.keys.map((k) =>
									k.keyCode !== "2,6"
										? k
										: { ...k, config: { ...k.config, type: "hotkey" } },
								),
							})),
						},
			),
		};
	const profiles = ManagedRuntime.make(
		Layer.mergeAll(
			ProfileService.DefaultWithoutDependencies,
			ProfileManager.DefaultWithoutDependencies,
			ProfileSwitching.DefaultWithoutDependencies,
		).pipe(
			Layer.provideMerge(
				repository.pipe(
					Layer.provide(
						Layer.mergeAll(
							ManagementProfileContractsLive,
							profileStorageLayer({
								read: async () => saved,
								write: async (next) => {
									if (failProfileWrite) throw new Error("disk failed");
									saved = next;
									writes++;
								},
							}),
						),
					),
				),
			),
			Layer.provide(
				Layer.succeed(ProfileSwitchingPort, {
					platform: "darwin",
					foreground: () => Effect.succeed(Option.none()),
					push: () => {
						deliveries++;
						if (failDelivery > 0) {
							failDelivery--;
							return Effect.fail(ProfileDeliveryFailed.fromCause(undefined));
						}
						return Effect.void;
					},
				}),
			),
		),
	);
	let state: AgentState = initialAgentState();
	let failAgentWrite = false;
	let selects = 0;
	const controller = profiles.runPromise(
		makeProfileController({
			confirm: async () => true,
			execute: async () => {},
			chooseApp: async () => Option.none(),
			capture: async () => "",
			cachedThumbnail: async () => Option.none(),
			publish: () => {},
			progress: () => {},
		}),
	);
	const select = async (id: string): Promise<ProfileEnvelope> => {
		selects++;
		const service = await controller;
		const result = await profiles.runPromise(
			service.request({ type: "manage", command: { type: "select", id } }),
		);
		if (result._tag === "rejected") throw new Error("selection rejected");
		return profiles.runPromise(ProfileManager.read());
	};
	const agents = ManagedRuntime.make(
		AgentsService.Default.pipe(
			Layer.provide(
				Layer.mergeAll(
					Layer.succeed(AgentStorage, {
						read: () => Effect.sync(() => Option.some(state)),
						write: (next) =>
							Effect.try({
								try: () => {
									if (failAgentWrite) throw new Error("commit failed");
									state = next;
								},
								catch: (cause) => new AgentStorageFailed(cause),
							}),
					}),
					Layer.succeed(AgentRuntimePort, {
						available: false,
						initial: {
							available: false,
							status: "stopped",
							code: "AGENT.RUNTIME.UNAVAILABLE",
							operation: "none",
						},
						start: Effect.void,
						stop: Effect.void,
						restart: Effect.void,
						subscribe: () => () => {},
					}),
					Layer.succeed(AgentPanelPort, agentProfileBinding(profiles, select)),
				),
			),
		),
	);
	return {
		profiles,
		agents,
		connect: () =>
			profiles.runPromise(
				Effect.flatMap(ProfileSwitching, (s) => s.connect("mock-unit", active)),
			),
		state: () => state,
		read: () => profiles.runPromise(ProfileManager.read()),
		writes: () => writes,
		selects: () => selects,
		deliveries: () => deliveries,
		failDelivery: (count: number) => {
			failDelivery = count;
		},
		failAgentWrite: () => {
			failAgentWrite = true;
		},
		failProfileWrite: () => {
			failProfileWrite = true;
		},
		dispose: async () => {
			await agents.dispose();
			await profiles.dispose();
		},
	};
}

import { AgentStorageFailed } from "../../../../../packages/edge/src/agents/agents-errors.js";

const allMain = Schema.decodeUnknownSync(Slots)({
	"1,5": "main",
	"1,6": "main",
	"2,5": "main",
	"2,6": "main",
});
const claw = (e: ProfileEnvelope) => e.profiles.find((p) => p.id === "1-8");
describe("DK-Claw sync through ProfileService and the real profile manager consumer", () => {
	it("rejects sync when repository defaults override the supplied canonical validators", async () => {
		const f = fixture("1-4", false, "repository-defaults");
		try {
			const before = await f.read();
			const result = await f.agents.runPromise(
				AgentsService.request({
					type: "sync-panel",
					slots: allMain,
					revision: 0,
				}).pipe(Effect.either),
			);
			expect(result._tag === "Left" && result.left.code).toBe(
				"AGENT.PANEL.SYNC_FAILED",
			);
			expect(await f.read()).toEqual(before);
			expect(f.writes()).toBe(0);
			expect(f.selects()).toBe(0);
			expect(f.state().revision).toBe(0);
		} finally {
			await f.dispose();
		}
	});
	it("preflights, saves revision-checked keys and defers while Vivid is active", async () => {
		const f = fixture();
		try {
			await f.connect();
			const progress: PanelProgress[] = [];
			const off = await f.agents.runPromise(
				Effect.map(AgentsService, (s) =>
					s.subscribeProgress((p) => progress.push(p)),
				),
			);
			const reply = await f.agents.runPromise(
				AgentsService.request({
					type: "sync-panel",
					slots: allMain,
					revision: 0,
				}),
			);
			off();
			expect(reply.view.progress).toMatchObject({
				percent: 100,
				deviceApplied: false,
			});
			expect(progress.map((p) => p.percent)).toEqual([5, 40, 80, 100]);
			expect(f.selects()).toBe(0);
			const profile = claw(await f.read());
			expect(profile?.revision).toBe(1);
			for (const code of Object.keys(allMain)) {
				const key = profile?.pages[0].keys.find((k) => k.keyCode === code);
				expect(
					key?.config.actions.find((a) => a.type === "agentId")?.value,
				).toBe("main");
				expect(key?.config.title.text).toBe("Main");
			}
		} finally {
			await f.dispose();
		}
	});
	it("applies through the existing manager when DK-Claw is active", async () => {
		const f = fixture("1-8");
		try {
			await f.connect();
			const before = f.deliveries();
			const reply = await f.agents.runPromise(
				AgentsService.request({
					type: "sync-panel",
					slots: allMain,
					revision: 0,
				}),
			);
			expect(reply.view.progress.deviceApplied).toBe(true);
			expect(f.selects()).toBe(1);
			expect(f.deliveries()).toBeGreaterThan(before);
		} finally {
			await f.dispose();
		}
	});
	it("rejects a replaced slot before writing or delivering", async () => {
		const f = fixture("1-4", true);
		try {
			const before = f.writes();
			const result = await f.agents.runPromise(
				AgentsService.request({
					type: "sync-panel",
					slots: allMain,
					revision: 0,
				}).pipe(Effect.either),
			);
			expect(result._tag === "Left" && result.left.code).toBe(
				"AGENT.PANEL.SLOT_INVALID",
			);
			expect(f.writes()).toBe(before);
			expect(f.selects()).toBe(0);
		} finally {
			await f.dispose();
		}
	});
	it("restores content and prior assignment when device delivery fails", async () => {
		const f = fixture("1-8");
		try {
			await f.connect();
			const before = claw(await f.read());
			f.failDelivery(1);
			const result = await f.agents.runPromise(
				AgentsService.request({
					type: "sync-panel",
					slots: allMain,
					revision: 0,
				}).pipe(Effect.either),
			);
			expect(result._tag === "Left" && result.left.code).toBe(
				"AGENT.PANEL.SYNC_FAILED",
			);
			const after = claw(await f.read());
			expect(after?.pages).toEqual(before?.pages);
			expect(after?.revision).toBe((before?.revision ?? 0) + 2);
			expect(f.state().revision).toBe(0);
		} finally {
			await f.dispose();
		}
	});
	it("rolls the profile back when committing the assignment fails", async () => {
		const f = fixture();
		try {
			const before = claw(await f.read());
			f.failAgentWrite();
			const result = await f.agents.runPromise(
				AgentsService.request({
					type: "sync-panel",
					slots: allMain,
					revision: 0,
				}).pipe(Effect.either),
			);
			expect(result._tag === "Left" && result.left.code).toBe(
				"AGENT.STORAGE.FAILED",
			);
			expect(claw(await f.read())?.pages).toEqual(before?.pages);
			expect(f.state().revision).toBe(0);
		} finally {
			await f.dispose();
		}
	});
	it("reports a distinct rollback failure when device restoration fails", async () => {
		const f = fixture("1-8");
		try {
			await f.connect();
			f.failDelivery(2);
			const result = await f.agents.runPromise(
				AgentsService.request({
					type: "sync-panel",
					slots: allMain,
					revision: 0,
				}).pipe(Effect.either),
			);
			expect(result._tag === "Left" && result.left.code).toBe(
				"AGENT.PANEL.ROLLBACK_FAILED",
			);
		} finally {
			await f.dispose();
		}
	});
});

for (const failure of ["none", "profile", "agent", "device"] as const) {
	it(`deletes assigned agents transactionally through saved DK-Claw profiles: ${failure}`, async () => {
		const f = fixture("1-8");
		try {
			await f.connect();
			await f.agents.runPromise(
				AgentsService.request({
					type: "create",
					id: "worker",
					name: "Worker",
					emoji: "W",
				}),
			);
			await f.agents.runPromise(
				AgentsService.request({
					type: "sync-panel",
					slots: { ...allMain, "1,5": "worker" },
					revision: f.state().revision,
				}),
			);
			const before = claw(await f.read());
			if (failure === "profile") f.failProfileWrite();
			if (failure === "agent") f.failAgentWrite();
			if (failure === "device") f.failDelivery(1);
			const result = await f.agents.runPromise(
				AgentsService.request({
					type: "delete",
					id: "worker",
					confirmed: true,
				}).pipe(Effect.either),
			);
			const after = claw(await f.read());
			if (failure === "none") {
				expect(result._tag).toBe("Right");
				expect(f.state().agents.some((a) => a.id === "worker")).toBe(false);
				expect(
					after?.pages[0].keys.find((k) => k.keyCode === "1,5")?.config.actions,
				).toContainEqual({ type: "agentId", value: "main" });
			} else {
				expect(result._tag).toBe("Left");
				expect(f.state().agents.some((a) => a.id === "worker")).toBe(true);
				expect(after?.pages).toEqual(before?.pages);
			}
		} finally {
			await f.dispose();
		}
	});
}
