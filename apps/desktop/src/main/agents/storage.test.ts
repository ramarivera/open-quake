import { mkdtemp, readdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, ManagedRuntime } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { initialAgentState } from "../../../../../packages/edge/src/agents/agents-invariants.js";
import { AgentRuntimePort } from "../../../../../packages/edge/src/agents/agents-ports.js";
import { AgentStorage } from "../../../../../packages/edge/src/agents/agents-repository.js";
import { AgentsService } from "../../../../../packages/edge/src/agents/agents-service.js";
import { createAgentStorage } from "./storage";

const roots: string[] = [];
afterEach(async () => {
	for (const root of roots.splice(0))
		await rm(root, { recursive: true, force: true });
});
const backend = {
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
describe("agent generation storage through the real service", () => {
	it("persists actual workspace and skill Markdown, reloads it and removes a deleted workspace", async () => {
		const root = await mkdtemp(join(await realpath(tmpdir()), "agents-store-"));
		roots.push(root);
		const storage = createAgentStorage(root);
		const layer = () =>
			AgentsService.Default.pipe(
				Layer.provide(
					Layer.mergeAll(
						Layer.succeed(AgentStorage, storage),
						Layer.succeed(AgentRuntimePort, backend),
					),
				),
			);
		let runtime = ManagedRuntime.make(layer());
		try {
			const created = await runtime.runPromise(
				AgentsService.request({
					type: "create",
					id: "researcher",
					name: "Researcher",
					emoji: "🦉",
				}),
			);
			let generation = await readFile(join(root, "current"), "utf8");
			expect(
				await readFile(
					join(root, generation, "workspaces/researcher/IDENTITY.md"),
					"utf8",
				),
			).toContain("Researcher");
			const content =
				"---\nname: Search\ndescription: Sources\n---\n\nSearch carefully.";
			const saved = await runtime.runPromise(
				AgentsService.request({
					type: "save-skill",
					create: true,
					folder: "search",
					owner: "",
					name: "Search",
					content,
					revision: created.view.revision,
				}),
			);
			await runtime.runPromise(
				AgentsService.request({
					type: "move-skill",
					folder: "search",
					owner: "",
					target: "researcher",
					revision: saved.view.revision,
				}),
			);
			generation = await readFile(join(root, "current"), "utf8");
			expect(
				await readFile(
					join(
						root,
						generation,
						"workspaces/researcher/skills/search/SKILL.md",
					),
					"utf8",
				),
			).toBe(content);
			await expect(
				readFile(join(root, generation, "skills/search/SKILL.md")),
			).rejects.toMatchObject({ code: "ENOENT" });
			await runtime.dispose();
			runtime = ManagedRuntime.make(layer());
			const view = await runtime.runPromise(AgentsService.view());
			expect(view.agents.map((a) => a.id)).toContain("researcher");
			expect(view.skills[0]?.owner).toBe("researcher");
			await runtime.runPromise(
				AgentsService.request({
					type: "delete",
					id: "researcher",
					confirmed: true,
				}),
			);
			generation = await readFile(join(root, "current"), "utf8");
			expect((await readdir(root)).sort()).toEqual(
				[generation, "current"].sort(),
			);
			expect(storage.cleanupFailures).toEqual([]);
			await expect(
				readFile(join(root, generation, "workspaces/researcher/IDENTITY.md")),
			).rejects.toMatchObject({ code: "ENOENT" });
		} finally {
			await runtime.dispose();
		}
	});
	it("leaves the committed pointer and all files intact after a staging failure", async () => {
		const root = await mkdtemp(
			join(await realpath(tmpdir()), "agents-failed-"),
		);
		roots.push(root);
		let fail = false;
		const storage = createAgentStorage(root, {
			beforeCommit: async () => {
				if (fail) throw new Error("disk full secret=private");
			},
		});
		const seed = initialAgentState();
		await Effect.runPromise(storage.write(seed));
		const pointer = await readFile(join(root, "current"), "utf8");
		fail = true;
		const result = await Effect.runPromise(
			storage.write({ ...seed, revision: 1 }).pipe(Effect.either),
		);
		expect(result._tag === "Left" && result.left.code).toBe(
			"AGENT.STORAGE.FAILED",
		);
		expect(JSON.stringify(result)).not.toContain("private");
		expect(await readFile(join(root, "current"), "utf8")).toBe(pointer);
		expect((await readdir(root)).sort()).toEqual([pointer, "current"].sort());
	});
});
