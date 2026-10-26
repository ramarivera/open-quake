import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import { expect, it, vi } from "vitest";
import {
	AgentPack,
	WorkspaceBackup,
} from "../../../../../packages/edge/src/agents/administration-contracts";
import type { AgentRuntimeAdapter } from "../../../../../packages/edge/src/agents/agents-ports";
import { AgentRuntimePort } from "../../../../../packages/edge/src/agents/agents-ports";
import { AgentStorage } from "../../../../../packages/edge/src/agents/agents-repository";
import { AgentsService } from "../../../../../packages/edge/src/agents/agents-service";
import { createAgentsHandler } from "./controller";
import { createAgentStorage } from "./storage";

const source = {
	senderId: 17,
	mainFrame: true,
	frameURL: "file:///app/index.html",
};
const backend: AgentRuntimeAdapter = {
	available: false,
	initial: {
		available: false,
		status: "stopped",
		operation: "none",
		code: "AGENT.RUNTIME.UNAVAILABLE",
	},
	start: Effect.void,
	stop: Effect.void,
	restart: Effect.void,
	subscribe: () => () => {},
};
async function fixture(adapter: AgentRuntimeAdapter = backend) {
	const root = await mkdtemp(join(tmpdir(), "agents-admin-"));
	let fail = false;
	const storage = createAgentStorage(root, {
		beforeCommit: async () => {
			if (fail) throw new Error("token=private-failure");
		},
	});
	const runtime = ManagedRuntime.make(
		AgentsService.Default.pipe(
			Layer.provide(
				Layer.mergeAll(
					Layer.succeed(AgentStorage, storage),
					Layer.succeed(AgentRuntimePort, adapter),
				),
			),
		),
	);
	return {
		root,
		request: createAgentsHandler(runtime, () => 17, "file:///app/index.html"),
		fail: () => {
			fail = true;
		},
		close: async () => {
			await runtime.dispose();
			await rm(root, { recursive: true, force: true });
		},
	};
}
it("CENTER-050 renames and resets only after confirmation, persists, and retains files after failed reset", async () => {
	const f = await fixture();
	try {
		const request = (input: unknown) => f.request(source, input);
		const created = await request({
			type: "create",
			id: "writer",
			name: "Writer",
			emoji: "🦉",
		});
		if (created._tag !== "success") throw new Error(created.code);
		const renamed = await request({
			type: "rename",
			id: "writer",
			name: "Author",
			revision: created.view.revision,
		});
		if (renamed._tag !== "success") throw new Error(renamed.code);
		expect(renamed.view.agents.find((a) => a.id === "writer")?.name).toBe(
			"Author",
		);
		const edited = await request({
			type: "save-file",
			id: "writer",
			file: "SOUL.md",
			content: "Personal edits",
			revision: renamed.view.revision,
		});
		if (edited._tag !== "success") throw new Error(edited.code);
		expect(
			await request({
				type: "reset-templates",
				id: "writer",
				confirmed: false,
				revision: edited.view.revision,
			}),
		).toMatchObject({ _tag: "rejected", code: "AGENT.KEY.INVALID" });
		const reset = await request({
			type: "reset-templates",
			id: "writer",
			confirmed: true,
			revision: edited.view.revision,
		});
		if (reset._tag !== "success") throw new Error(reset.code);
		expect(
			reset.view.agents.find((a) => a.id === "writer")?.files["SOUL.md"],
		).not.toBe("Personal edits");
		expect(
			await request({
				type: "rename",
				id: "main",
				name: "Changed",
				revision: reset.view.revision,
			}),
		).toMatchObject({ _tag: "rejected", code: "AGENT.MAIN.PROTECTED" });
		f.fail();
		expect(
			await request({
				type: "reset-templates",
				id: "writer",
				confirmed: true,
				revision: reset.view.revision,
			}),
		).toMatchObject({ _tag: "rejected", code: "AGENT.STORAGE.FAILED" });
		expect(await request({ type: "read" })).toMatchObject({
			_tag: "success",
			view: { revision: reset.view.revision, agents: reset.view.agents },
		});
		expect((await readdir(f.root)).filter((x) => x !== "current")).toHaveLength(
			1,
		);
	} finally {
		await f.close();
	}
});
it("CENTER-104/MAIN-144 round trips a portable pack and rejects escaping, credential and malformed imports before any workspace commit", async () => {
	const a = await fixture(),
		b = await fixture();
	try {
		const request = (input: unknown) => a.request(source, input);
		await request({
			type: "create",
			id: "writer",
			name: "Writer",
			emoji: "🦉",
		});
		const exported = await request({ type: "export-pack", id: "writer" });
		if (exported._tag !== "success") throw new Error(exported.code);
		const pack = Schema.decodeUnknownSync(Schema.parseJson(AgentPack))(
			exported.draft,
		);
		const before = await b.request(source, { type: "read" });
		if (before._tag !== "success") throw new Error(before.code);
		for (const invalid of [
			"{",
			JSON.stringify({ ...pack, credentialRef: "private-token" }),
			JSON.stringify({
				...pack,
				agent: { ...pack.agent, files: { "../escape.md": "bad" } },
			}),
			JSON.stringify({ ...pack, agent: { ...pack.agent, id: "main" } }),
		]) {
			expect(
				await b.request(source, {
					type: "import-pack",
					pack: invalid,
					revision: before.view.revision,
				}),
			).toMatchObject({ _tag: "rejected" });
			expect(await b.request(source, { type: "read" })).toMatchObject({
				_tag: "success",
				view: { revision: before.view.revision, agents: before.view.agents },
			});
		}
		const imported = await b.request(source, {
			type: "import-pack",
			pack: exported.draft,
			revision: before.view.revision,
		});
		if (imported._tag !== "success") throw new Error(imported.code);
		expect(imported.view.agents.find((x) => x.id === "writer")).toEqual(
			pack.agent,
		);
		expect(
			await b.request(source, { type: "export-pack", id: "writer" }),
		).toMatchObject({ _tag: "success", draft: exported.draft });
		const backupReply = await b.request(source, {
			type: "export-workspace-backup",
		});
		if (backupReply._tag !== "success") throw new Error(backupReply.code);
		const backup = Schema.decodeUnknownSync(Schema.parseJson(WorkspaceBackup))(
			backupReply.draft,
		);
		expect(backup.agents).toEqual(imported.view.agents);
		expect(backup.skills).toEqual(imported.view.skills);
		expect(backup.slots).toEqual(imported.view.slots);
		expect(backupReply.draft).not.toMatch(
			/credentialRef|private-token|baseUrl|"models"/,
		);
		const diagnostics = await b.request(source, { type: "diagnostics" });
		expect(diagnostics).toMatchObject({ _tag: "success" });
		if (diagnostics._tag === "success") {
			expect(JSON.parse(diagnostics.draft)).toMatchObject({
				agents: 2,
				processAdministration: false,
				logs: [],
			});
			expect(diagnostics.draft).not.toMatch(
				/private-token|credentialRef|Personal edits/,
			);
		}
		for (const type of [
			"service-settings",
			"clear-runtime-data",
			"update-environment",
		]) {
			const input =
				type === "service-settings"
					? { type }
					: type === "clear-runtime-data"
						? { type, confirmed: true, revision: imported.view.revision }
						: {
								type,
								environment: { logLevel: "debug" },
								revision: imported.view.revision,
							};
			expect(await b.request(source, input)).toMatchObject({
				_tag: "rejected",
				code: "AGENT.RUNTIME.UNAVAILABLE",
			});
		}
	} finally {
		await a.close();
		await b.close();
	}
});

it("CENTER-052 shared to A to B to shared transfers are durable and conflicting targets preserve both skills", async () => {
	const f = await fixture();
	try {
		const request = (input: unknown) => f.request(source, input);
		await request({ type: "create", id: "alpha", name: "Alpha", emoji: "" });
		const created = await request({
			type: "create",
			id: "beta",
			name: "Beta",
			emoji: "",
		});
		if (created._tag !== "success") throw new Error(created.code);
		let revision = created.view.revision;
		const skill = {
			folder: "search",
			name: "Search",
			content: "---\nname: Search\ndescription: Find sources\n---\nSearch.",
		};
		const saved = await request({
			type: "save-skill",
			create: true,
			owner: "",
			...skill,
			revision,
		});
		if (saved._tag !== "success") throw new Error(saved.code);
		revision = saved.view.revision;
		for (const [owner, target] of [
			["", "alpha"],
			["alpha", "beta"],
			["beta", ""],
		]) {
			const moved = await request({
				type: "move-skill",
				folder: skill.folder,
				owner,
				target,
				revision,
			});
			if (moved._tag !== "success") throw new Error(moved.code);
			revision = moved.view.revision;
			expect(
				moved.view.skills
					.filter((s) => s.folder === skill.folder)
					.map((s) => s.owner),
			).toEqual([target]);
		}
		const duplicate = await request({
			type: "save-skill",
			create: true,
			owner: "alpha",
			...skill,
			revision,
		});
		if (duplicate._tag !== "success") throw new Error(duplicate.code);
		expect(
			await request({
				type: "move-skill",
				folder: skill.folder,
				owner: "",
				target: "alpha",
				revision: duplicate.view.revision,
			}),
		).toMatchObject({ _tag: "rejected", code: "AGENT.SKILL.CONFLICT" });
		expect(await request({ type: "read" })).toMatchObject({
			_tag: "success",
			view: duplicate.view,
		});
	} finally {
		await f.close();
	}
});

it("CENTER-104/MAIN-144 rejects invalid settings and environment before an owned capability dispatch; diagnostics omit private values", async () => {
	const setting = {
		port: 18789,
		logLevel: "info" as const,
		autoStart: false,
		dataDirectory: "/private/runtime",
	};
	const save = vi.fn(() => Effect.void),
		environment = vi.fn(() => Effect.void);
	const f = await fixture({
		...backend,
		available: true,
		initial: { ...backend.initial, available: true },
		administration: {
			settings: () => Effect.succeed(setting),
			save,
			environment,
			clear: Effect.void,
			logs: () =>
				Effect.succeed([{ status: "stopped", operation: "none", code: "" }]),
		},
	});
	try {
		const read = await f.request(source, { type: "read" });
		if (read._tag !== "success") throw new Error(read.code);
		for (const command of [
			{
				type: "update-environment",
				environment: { logLevel: "debug", TOKEN: "private" },
			},
			{ type: "update-environment", environment: { logLevel: "invalid" } },
			{
				type: "save-service-settings",
				settings: { ...setting, port: 65536 },
				restart: false,
			},
			{
				type: "save-service-settings",
				settings: { ...setting, port: 0 },
				restart: false,
			},
		])
			expect(
				await f.request(source, { ...command, revision: read.view.revision }),
			).toMatchObject({ _tag: "rejected" });
		expect(save).not.toHaveBeenCalled();
		expect(environment).not.toHaveBeenCalled();
		const report = await f.request(source, { type: "diagnostics" });
		if (report._tag !== "success") throw new Error(report.code);
		expect(JSON.parse(report.draft)).toMatchObject({
			runtimeMode: "owned",
			backup: {
				kind: "user-exported-workspaces",
				maxBytes: 2097152,
				includesCredentials: false,
			},
			processAdministration: true,
		});
		expect(report.draft).not.toContain("/private");
		expect(report.draft).not.toContain("TOKEN");
	} finally {
		await f.close();
	}
});
