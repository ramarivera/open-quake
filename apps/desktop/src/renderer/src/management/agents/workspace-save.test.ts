import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { expect, it } from "vitest";
import type { AgentState } from "../../../../../../../packages/edge/src/agents/agents-contracts";
import { AgentStorageFailed } from "../../../../../../../packages/edge/src/agents/agents-errors";
import { initialAgentState } from "../../../../../../../packages/edge/src/agents/agents-invariants";
import { AgentRuntimePort } from "../../../../../../../packages/edge/src/agents/agents-ports";
import { AgentStorage } from "../../../../../../../packages/edge/src/agents/agents-repository";
import { AgentsService } from "../../../../../../../packages/edge/src/agents/agents-service";
import { createAgentsHandler } from "../../../../main/agents/controller";
import { saveWorkspaceFiles } from "./workspace-save";

it("retains unsaved tabs on a partial failure and retries only remaining edits through production authorization and storage", async () => {
	let state: AgentState = initialAgentState();
	let writes = 0;
	let failAt = Number.POSITIVE_INFINITY;
	const runtime = ManagedRuntime.make(
		AgentsService.Default.pipe(
			Layer.provide(
				Layer.mergeAll(
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
					Layer.succeed(AgentStorage, {
						read: () => Effect.succeed(Option.some(state)),
						write: (next) =>
							Effect.suspend(() => {
								if (++writes === failAt)
									return Effect.fail(
										new AgentStorageFailed(new Error("private failure")),
									);
								state = next;
								return Effect.void;
							}),
					}),
				),
			),
		),
	);
	const handler = createAgentsHandler(
		runtime,
		() => 42,
		"file:///synthetic/index.html",
	);
	const calls: unknown[] = [];
	const request = (
		input: Parameters<Parameters<typeof saveWorkspaceFiles>[0]["request"]>[0],
	) => {
		calls.push(input);
		return handler(
			{
				senderId: 42,
				mainFrame: true,
				frameURL: "file:///synthetic/index.html",
			},
			input,
		);
	};
	try {
		const created = await request({
			type: "create",
			id: "researcher",
			name: "Researcher",
			emoji: "",
		});
		expect(created._tag).toBe("success");
		let saved = {
			...state.agents.find((agent) => agent.id === "researcher")?.files,
		};
		const files = {
			"IDENTITY.md": "new identity",
			"SOUL.md": "new soul",
			"AGENTS.md": "new guidance",
		};
		const onSaved = (file: string, content: string) => {
			saved = { ...saved, [file]: content };
		};
		failAt = writes + 2;
		const rejected = await saveWorkspaceFiles({
			id: "researcher",
			files,
			saved,
			revision: state.revision,
			request,
			onSaved,
		});
		expect(rejected?.code).toBe("AGENT.STORAGE.FAILED");
		expect(saved["IDENTITY.md"]).toBe(files["IDENTITY.md"]);
		expect(saved["SOUL.md"]).not.toBe(files["SOUL.md"]);
		expect(
			state.agents.find((agent) => agent.id === "researcher")?.files[
				"AGENTS.md"
			],
		).not.toBe(files["AGENTS.md"]);
		const partialRevision = state.revision;
		calls.length = 0;
		failAt = Number.POSITIVE_INFINITY;
		expect(
			await saveWorkspaceFiles({
				id: "researcher",
				files,
				saved,
				revision: partialRevision,
				request,
				onSaved,
			}),
		).toBeUndefined();
		expect(calls).toEqual([
			{
				type: "save-file",
				id: "researcher",
				file: "SOUL.md",
				content: files["SOUL.md"],
				revision: partialRevision,
			},
			{
				type: "save-file",
				id: "researcher",
				file: "AGENTS.md",
				content: files["AGENTS.md"],
				revision: partialRevision + 1,
			},
		]);
		const reloaded = await request({ type: "read" });
		expect(
			reloaded._tag === "success" &&
				reloaded.view.agents.find((agent) => agent.id === "researcher")?.files,
		).toEqual(files);
	} finally {
		await runtime.dispose();
	}
});
