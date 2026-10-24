import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Redacted, Schema } from "effect";
import fc from "fast-check";
import { AgentId, type AgentState } from "./agents-contracts.js";
import {
	AgentDraftFailed,
	AgentStorageFailed,
	SkillMoveIncomplete,
} from "./agents-errors.js";
import {
	agentIdError,
	initialAgentState,
	sanitizeAgentId,
} from "./agents-invariants.js";
import {
	AgentCredentialPort,
	type AgentDraftAdapter,
	AgentDraftPort,
	AgentRuntimePort,
} from "./agents-ports.js";
import { AgentStorage, type AgentStoragePort } from "./agents-repository.js";
import { AgentsService } from "./agents-service.js";
export const unavailableRuntime = {
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
} satisfies typeof AgentRuntimePort.Service;
function fixture(drafting?: AgentDraftAdapter) {
	let state: AgentState = initialAgentState();
	let fail = false;
	const keys = new Map<string, string>();
	let calls = 0;
	const storage: AgentStoragePort = {
		read: () => Effect.sync(() => Option.some(state)),
		write: (next) =>
			fail
				? Effect.fail(new AgentStorageFailed(new Error("token=super-secret")))
				: Effect.sync(() => {
						state = next;
					}),
	};
	const ports = Layer.mergeAll(
		Layer.succeed(AgentStorage, storage),
		Layer.succeed(AgentRuntimePort, unavailableRuntime),
		Layer.succeed(AgentCredentialPort, {
			store: (secret) =>
				Effect.sync(() => {
					const reference = `vault-${++calls}`;
					keys.set(reference, Redacted.value(secret));
					return reference;
				}),
			available: (ref) => Effect.sync(() => keys.has(ref)),
			remove: (ref) =>
				Effect.sync(() => {
					keys.delete(ref);
				}),
		}),
		drafting ? Layer.succeed(AgentDraftPort, drafting) : Layer.empty,
	);
	return {
		layer: AgentsService.Default.pipe(Layer.provide(ports)),
		state: () => state,
		fail: (value: boolean) => {
			fail = value;
		},
		keys,
	};
}
const create = (service: AgentsService, id = "researcher") =>
	service.request({ type: "create", id, name: "Researcher", emoji: "🦉" });
const skill =
	"---\nname: Web search\ndescription: Find sources\n---\n\nCite sources.\n";
const model = (
	id: string,
	role: "default" | "fallback" | "none" = "none",
	provider = "openai",
	baseUrl = "https://api.openai.com/v1",
) => ({
	id,
	role,
	provider,
	model: id === "initial" ? "gpt-4o" : "gpt-4o-mini",
	baseUrl,
	maxTokens: 4096,
});
describe("AgentsService real consumer", () => {
	it.effect(
		"creates the workspace at Next, edits files with revision checks and protects main",
		() => {
			const f = fixture();
			return Effect.gen(function* () {
				const service = yield* AgentsService;
				const created = yield* create(service);
				expect(
					Object.keys(
						created.view.agents.find((a) => a.id === "researcher")?.files ?? {},
					),
				).toEqual(["IDENTITY.md", "SOUL.md", "AGENTS.md"]);
				const saved = yield* service.request({
					type: "save-file",
					id: "researcher",
					file: "SOUL.md",
					content: "Be precise.",
					revision: created.view.revision,
				});
				expect(
					saved.view.agents.find((a) => a.id === "researcher")?.files[
						"SOUL.md"
					],
				).toBe("Be precise.");
				const stale = yield* service
					.request({
						type: "save-file",
						id: "researcher",
						file: "SOUL.md",
						content: "Lost update",
						revision: created.view.revision,
					})
					.pipe(Effect.either);
				expect(stale._tag === "Left" && stale.left.code).toBe(
					"AGENT.REVISION.CONFLICT",
				);
				for (const input of [
					{ type: "create", id: "main", name: "Replacement", emoji: "🤖" },
					{ type: "delete", id: "main", confirmed: true },
					{
						type: "save-file",
						id: "main",
						file: "SOUL.md",
						content: "changed",
						revision: saved.view.revision,
					},
				]) {
					const result = yield* service.request(input).pipe(Effect.either);
					expect(result._tag === "Left" && result.left.code).toBe(
						"AGENT.MAIN.PROTECTED",
					);
				}
				const duplicate = yield* create(service).pipe(Effect.either);
				expect(duplicate._tag === "Left" && duplicate.left.code).toBe(
					"AGENT.KEY.DUPLICATE",
				);
				yield* service.request({
					type: "delete",
					id: "researcher",
					confirmed: true,
				});
				expect(f.state().agents.map((a) => a.id)).toEqual(["main"]);
			}).pipe(Effect.provide(f.layer));
		},
	);
	it("sanitizes arbitrary input into the exact bounded DK character set", () =>
		fc.assert(
			fc.property(fc.string(), (raw) => {
				const id = sanitizeAgentId(raw);
				expect(id.length).toBeLessThanOrEqual(48);
				expect(id).toMatch(/^[a-z0-9-]*$/);
				expect(sanitizeAgentId(id)).toBe(id);
			}),
		));
	it.effect(
		"moves skills atomically and distinguishes conflict, stale source, invalid workspace and incomplete commit",
		() => {
			const f = fixture();
			return Effect.gen(function* () {
				const service = yield* AgentsService;
				yield* create(service);
				let view = yield* service.view();
				view = (yield* service.request({
					type: "save-skill",
					create: true,
					folder: "web-search",
					owner: "",
					name: "Web search",
					content: skill,
					revision: view.revision,
				})).view;
				view = (yield* service.request({
					type: "save-skill",
					create: true,
					folder: "web-search",
					owner: "researcher",
					name: "Web search",
					content: skill,
					revision: view.revision,
				})).view;
				const move = (target: string, revision = view.revision) =>
					service
						.request({
							type: "move-skill",
							folder: "web-search",
							owner: "",
							target,
							revision,
						})
						.pipe(Effect.either);
				expect((yield* move("researcher"))._tag).toBe("Left");
				const conflict = yield* move("researcher");
				expect(conflict._tag === "Left" && conflict.left.code).toBe(
					"AGENT.SKILL.CONFLICT",
				);
				const invalid = yield* move("main");
				expect(invalid._tag === "Left" && invalid.left.code).toBe(
					"AGENT.SKILL.WORKSPACE_INVALID",
				);
				const stale = yield* move("researcher", 0);
				expect(stale._tag === "Left" && stale.left.code).toBe(
					"AGENT.SKILL.MOVED",
				);
				view = (yield* service.request({
					type: "delete-skill",
					folder: "web-search",
					owner: "researcher",
					confirmed: true,
					revision: view.revision,
				})).view;
				const before = f.state();
				f.fail(true);
				const failed = yield* move("researcher", view.revision);
				expect(failed._tag).toBe("Left");
				if (failed._tag === "Left") {
					expect(failed.left).toBeInstanceOf(SkillMoveIncomplete);
					expect(failed.left.code).toBe("AGENT.SKILL.MOVE_INCOMPLETE");
					expect(JSON.stringify(failed.left)).not.toContain("super-secret");
				}
				expect(f.state()).toBe(before);
				f.fail(false);
				view = (yield* service.request({
					type: "move-skill",
					folder: "web-search",
					owner: "",
					target: "researcher",
					revision: view.revision,
				})).view;
				expect(view.skills.map((s) => s.owner)).toEqual(["researcher"]);
				view = (yield* service.request({
					type: "move-skill",
					folder: "web-search",
					owner: "researcher",
					target: "",
					revision: view.revision,
				})).view;
				expect(view.skills.map((s) => s.owner)).toEqual([""]);
			}).pipe(Effect.provide(f.layer));
		},
	);
	it.effect(
		"keeps files unchanged when drafting is unavailable or fails",
		() => {
			const f = fixture();
			return Effect.gen(function* () {
				const service = yield* AgentsService;
				const { view } = yield* create(service);
				const before = f.state();
				const result = yield* service
					.request({
						type: "draft-agent",
						id: "researcher",
						prompt: "Research carefully",
						revision: view.revision,
					})
					.pipe(Effect.either);
				expect(result._tag === "Left" && result.left.code).toBe(
					"AGENT.DRAFT.UNAVAILABLE",
				);
				expect(f.state()).toBe(before);
			}).pipe(Effect.provide(f.layer));
		},
	);
	it.effect(
		"applies drafts through the real consumer only after validation",
		() => {
			const f = fixture({
				agent: () =>
					Effect.succeed({ "SOUL.md": "# Research\nCite evidence." }),
				skill: () => Effect.succeed(skill),
			});
			return Effect.gen(function* () {
				const service = yield* AgentsService;
				const { view } = yield* create(service);
				const generated = yield* service.request({
					type: "draft-agent",
					id: "researcher",
					prompt: "Research carefully",
					revision: view.revision,
				});
				expect(
					generated.view.agents.find((a) => a.id === "researcher")?.files[
						"SOUL.md"
					],
				).toContain("Cite evidence");
				const revision = f.state().revision;
				const draftedSkill = yield* service.request({
					type: "draft-skill",
					name: "Web search",
					prompt: "sources",
				});
				expect(draftedSkill.draft).toBe(skill);
				expect(f.state().revision).toBe(revision);
			}).pipe(Effect.provide(f.layer));
		},
	);
	it.effect(
		"rejects a draft that tries to write outside the Markdown workspace",
		() => {
			const f = fixture({
				agent: () => Effect.succeed({ "../escape.md": "bad" }),
				skill: () => Effect.fail(new AgentDraftFailed()),
			});
			return Effect.gen(function* () {
				const service = yield* AgentsService;
				const { view } = yield* create(service);
				const before = f.state();
				const result = yield* service
					.request({
						type: "draft-agent",
						id: "researcher",
						prompt: "escape",
						revision: view.revision,
					})
					.pipe(Effect.either);
				expect(result._tag === "Left" && result.left.code).toBe(
					"AGENT.DRAFT.FAILED",
				);
				expect(f.state()).toBe(before);
			}).pipe(Effect.provide(f.layer));
		},
	);
	it.effect(
		"maintains default/fallback routing, URL siblings, inheritance and write-only credentials",
		() => {
			const f = fixture();
			return Effect.gen(function* () {
				const service = yield* AgentsService;
				yield* create(service);
				let view = yield* service.view();
				const save = (row: ReturnType<typeof model>, secret = "") =>
					service.request({
						type: "save-model",
						scope: "default",
						row,
						secret,
						revision: view.revision,
					});
				view = (yield* save(model("initial", "default"), "very-secret-key"))
					.view;
				expect(JSON.stringify(view)).not.toContain("very-secret-key");
				expect(JSON.stringify(view)).not.toContain("vault-1");
				expect(view.models.default?.[0]?.credentialAvailable).toBe(true);
				view = (yield* save(model("b", "fallback"))).view;
				view = (yield* save(model("c", "fallback"))).view;
				expect((yield* service.resolve("researcher")).map((r) => r.id)).toEqual(
					["initial", "b", "c"],
				);
				view = (yield* save(model("b", "default"))).view;
				expect(
					view.models.default
						?.filter((r) => r.role === "default")
						.map((r) => r.id),
				).toEqual(["b"]);
				view = (yield* save(model("b", "none"))).view;
				expect(view.models.default?.find((r) => r.id === "initial")?.role).toBe(
					"default",
				);
				view = (yield* save(
					model("initial", "default", "openai", "https://proxy.example/v1"),
				)).view;
				expect(
					view.models.default?.every(
						(r) => r.baseUrl === "https://proxy.example/v1",
					),
				).toBe(true);
				view = (yield* service.request({
					type: "inherit",
					scope: "researcher",
					enabled: false,
					revision: view.revision,
				})).view;
				view = (yield* save(
					model("initial", "default", "openai", "https://different.example/v1"),
				)).view;
				expect((yield* service.resolve("researcher"))[0]?.baseUrl).toBe(
					"https://proxy.example/v1",
				);
				view = (yield* service.request({
					type: "inherit",
					scope: "researcher",
					enabled: true,
					revision: view.revision,
				})).view;
				expect((yield* service.resolve("researcher"))[0]?.baseUrl).toBe(
					"https://different.example/v1",
				);
				const invalid = yield* save(
					model("bad", "none", "openai", "file:///etc/passwd"),
				).pipe(Effect.either);
				expect(invalid._tag === "Left" && invalid.left.code).toBe(
					"AGENT.MODEL.INVALID",
				);
			}).pipe(Effect.provide(f.layer));
		},
	);
	it.effect(
		"reverts demotion of the only row and rejects deleting the last default row",
		() => {
			const f = fixture();
			return Effect.gen(function* () {
				const service = yield* AgentsService;
				let view = yield* service.view();
				view = (yield* service.request({
					type: "save-model",
					scope: "default",
					row: model("initial", "none"),
					secret: "",
					revision: view.revision,
				})).view;
				expect(view.models.default?.[0]?.role).toBe("default");
				const result = yield* service
					.request({
						type: "delete-model",
						scope: "default",
						id: "initial",
						confirmed: true,
						revision: view.revision,
					})
					.pipe(Effect.either);
				expect(result._tag === "Left" && result.left.code).toBe(
					"AGENT.MODEL.LAST_ROW",
				);
				expect(Schema.is(AgentId)("main")).toBe(true);
			}).pipe(Effect.provide(f.layer));
		},
	);
	it("retains original causes privately and scrubs serialized diagnostics", () => {
		const cause = new Error("https://example.test/?token=secret");
		const error = new AgentStorageFailed(cause);
		expect(error.originalCause).toBe(cause);
		expect(JSON.stringify(error)).not.toMatch(/secret|example\.test/);
		expect(error.code).toBe("AGENT.STORAGE.FAILED");
	});
});

it.effect(
	"reserves the global model scope without altering defaults or inherited routing",
	() => {
		const f = fixture();
		return Effect.gen(function* () {
			const service = yield* AgentsService;
			yield* service.request({
				type: "save-model",
				scope: "default",
				row: model("initial", "default"),
				secret: "synthetic-key",
				revision: 0,
			});
			const before = f.state();
			expect(agentIdError("default", before.agents)).toBe("reserved");
			const rejected = yield* create(service, "default").pipe(Effect.either);
			expect(rejected._tag).toBe("Left");
			expect(f.state()).toEqual(before);
			expect(yield* service.resolve("main")).toEqual(before.models.default);
		}).pipe(Effect.provide(f.layer));
	},
);
