import { Effect, type ManagedRuntime } from "effect";
import { AgentsService } from "../../../../../packages/edge/src/agents/agents-service.js";
import type { AgentReply } from "../../shared/agents";
export interface AgentsAuthority {
	readonly senderId: number;
	readonly frameURL: string;
	readonly mainFrame: boolean;
}
export function agentRequestAllowed(
	source: AgentsAuthority,
	managementId: number | undefined,
	renderer: string,
): boolean {
	if (source.senderId !== managementId || !source.mainFrame) return false;
	try {
		const actual = new URL(source.frameURL),
			expected = new URL(renderer);
		return (
			actual.origin === expected.origin &&
			actual.protocol === expected.protocol &&
			actual.host === expected.host &&
			actual.pathname === expected.pathname &&
			actual.username === "" &&
			actual.password === ""
		);
	} catch {
		return false;
	}
}
/** The production IPC consumer is exported so tests use the same authorization and command path. */
export const createAgentsHandler =
	(
		runtime: ManagedRuntime.ManagedRuntime<AgentsService, never>,
		managementId: () => number | undefined,
		renderer: string,
	) =>
	(source: AgentsAuthority, input: unknown): Promise<AgentReply> => {
		if (!agentRequestAllowed(source, managementId(), renderer))
			return Promise.resolve({
				_tag: "rejected",
				code: "AGENT.IPC.UNAUTHORIZED",
				message: "Unauthorized agent request",
			});
		return runtime.runPromise(
			AgentsService.request(input).pipe(
				Effect.match({
					onSuccess: ({ view, draft }): AgentReply => ({
						_tag: "success",
						view,
						draft,
					}),
					onFailure: (error): AgentReply => ({
						_tag: "rejected",
						code: error.code,
						message: error.message,
					}),
				}),
			),
		);
	};
