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
	ProfileEnvelope,
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
	const delivered: { serial: string; profileId: string }[] = [];
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
					push: (serial, profile) => {
						deliveries++;
						delivered.push({ serial, profileId: profile.id });
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
					Layer.succeed(AgentPanelPort, agentProfileBinding(profiles)),
				),
			),
		),
	);
	return {
		profiles,
		agents,
		connect: (serial = "mock-unit", id = active) =>
			profiles.runPromise(
				Effect.flatMap(ProfileSwitching, (s) => s.connect(serial, id)),
			),
		state: () => state,
		read: () => profiles.runPromise(ProfileManager.read()),
		writes: () => writes,
		delivered,
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
	it("redelivers committed DK-Claw content when active", async () => {
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

for (const failure of ["none", "delivery", "agent"] as const) {
	it(`keeps unrelated device and preview selections during sync and compensation: ${failure}`, async () => {
		const f = fixture("1-8");
		try {
			await f.connect();
			await f.connect("other-unit", "1-4");
			await f.profiles.runPromise(
				ProfileService.selectProfile({
					deviceId: "desktop-preview",
					profileId: "1-4",
				}),
			);
			const before = await f.read();
			const count = f.delivered.length;
			if (failure === "delivery") f.failDelivery(1);
			if (failure === "agent") f.failAgentWrite();
			const result = await f.agents.runPromise(
				AgentsService.request({
					type: "sync-panel",
					slots: allMain,
					revision: 0,
				}).pipe(Effect.either),
			);
			expect(result._tag).toBe(failure === "none" ? "Right" : "Left");
			const after = await f.read();
			expect(after.activeByDevice).toEqual(before.activeByDevice);
			expect(f.delivered.slice(count).length).toBeGreaterThan(0);
			expect(
				f.delivered
					.slice(count)
					.every(
						(entry) =>
							entry.serial === "mock-unit" && entry.profileId === "1-8",
					),
			).toBe(true);
			if (failure !== "none")
				expect(claw(after)?.pages).toEqual(claw(before)?.pages);
		} finally {
			await f.dispose();
		}
	});
}
it("rechecks selection when a device leaves DK-Claw after preparation", async () => {
	const f = fixture("1-8");
	try {
		await f.connect();
		const transaction = await Effect.runPromise(
			agentProfileBinding(f.profiles).prepare(allMain, f.state().agents),
		);
		await f.profiles.runPromise(
			Effect.flatMap(ProfileSwitching, (service) =>
				service.selectNow("mock-unit", "1-4"),
			),
		);
		const count = f.deliveries();
		const before = await f.read();
		expect(await Effect.runPromise(transaction.apply)).toBe(false);
		await Effect.runPromise(transaction.rollback);
		expect(f.deliveries()).toBe(count);
		expect((await f.read()).activeByDevice).toEqual(before.activeByDevice);
	} finally {
		await f.dispose();
	}
});

it("MGMT-348/349 round trips the exact protected DK Claw preset and preserves all four agent ID bindings", async () => {
	const f = fixture("1-8");
	try {
		const profile = claw(await f.read());
		if (!profile) throw new Error("missing preset");
		const conversation = profile.pages[0].keys.find((k) => k.keyCode === "1,1");
		expect(conversation?.config).toMatchObject({
			type: "quakeBot",
			size: [4, 2],
			title: { text: "ClawBotView", pos: "top", size: 6 },
			actions: [
				{ type: "agentId", value: "default" },
				{ type: "ttsEngine", value: "qwen" },
				{ type: "modeltype", value: "qwen-audio-3.1-tts-flash" },
			],
		});
		const saved = encodeProfileEnvelope(await f.read());
		expect(
			Schema.encodeSync(ProfileEnvelope)(
				Schema.decodeUnknownSync(ProfileEnvelope)(saved),
			),
		).toEqual(saved);
		await f.connect();
		for (const [code, id] of [
			["1,5", "materialfinder"],
			["1,6", "stockmaster"],
			["2,5", "dataorganizer"],
			["2,6", "techex"],
		]) {
			const key = profile.pages[0].keys.find((k) => k.keyCode === code);
			expect(key?.config).toMatchObject({
				type: "clawbot",
				size: [1, 1],
				actions: [
					{ type: "voiceInput", value: true },
					{ type: "taskPrompt", value: "" },
					{ type: "agentId", value: id },
				],
			});
		}
		expect(claw(await f.read())?.pages).toEqual(profile.pages);
		expect(claw(await f.read())?.compatibility).toEqual(profile.compatibility);
	} finally {
		await f.dispose();
	}
});
