import { join } from "node:path";
import { Effect, Layer, ManagedRuntime } from "effect";
import { app, type BrowserWindow, ipcMain } from "electron";
import { AgentRuntimeUnavailable } from "../../../../../packages/edge/src/agents/agents-errors.js";
import {
	type AgentCredentialAdapter,
	AgentCredentialPort,
	type AgentDraftAdapter,
	AgentDraftPort,
	AgentPanelPort,
	type AgentRuntimeAdapter,
	AgentRuntimePort,
} from "../../../../../packages/edge/src/agents/agents-ports.js";
import { AgentStorage } from "../../../../../packages/edge/src/agents/agents-repository.js";
import { AgentsService } from "../../../../../packages/edge/src/agents/agents-service.js";
import {
	AGENTS_PROGRESS,
	AGENTS_REQUEST,
	AGENTS_SNAPSHOT,
} from "../../shared/agents";
import { agentRequestAllowed, createAgentsHandler } from "./controller";
import { agentProfileBinding, type ProfilesRuntime } from "./profile-binding";
import { createAgentStorage } from "./storage";
export const unavailableAgentRuntime: AgentRuntimeAdapter = {
	available: false,
	initial: {
		available: false,
		status: "stopped",
		code: "AGENT.RUNTIME.UNAVAILABLE",
		operation: "none",
	},
	start: Effect.fail(new AgentRuntimeUnavailable()),
	stop: Effect.fail(new AgentRuntimeUnavailable()),
	restart: Effect.fail(new AgentRuntimeUnavailable()),
	subscribe: () => () => {},
};
export interface RegisterAgentsOptions {
	readonly management: () => BrowserWindow | undefined;
	readonly renderer: string;
	readonly profiles: ProfilesRuntime;
	readonly root?: string;
	readonly backend?: AgentRuntimeAdapter;
	readonly drafting?: AgentDraftAdapter;
	readonly credentials?: AgentCredentialAdapter;
}
/** No import side effects. The application root owns backend selection and shutdown. */
export function registerAgents(options: RegisterAgentsOptions) {
	const ports = Layer.mergeAll(
		Layer.succeed(
			AgentStorage,
			createAgentStorage(
				options.root ?? join(app.getPath("userData"), "agents-v1"),
			),
		),
		Layer.succeed(AgentRuntimePort, options.backend ?? unavailableAgentRuntime),
		Layer.succeed(AgentPanelPort, agentProfileBinding(options.profiles)),
		options.drafting
			? Layer.succeed(AgentDraftPort, options.drafting)
			: Layer.empty,
		options.credentials
			? Layer.succeed(AgentCredentialPort, options.credentials)
			: Layer.empty,
	);
	const runtime = ManagedRuntime.make(
		AgentsService.Default.pipe(Layer.provide(ports)),
	);
	const handler = createAgentsHandler(
		runtime,
		() => options.management()?.webContents.id,
		options.renderer,
	);
	let disposed = false;
	const pending = new Set<Promise<unknown>>();
	const send = async (): Promise<void> => {
		const snapshot = await runtime.runPromise(
			AgentsService.view().pipe(Effect.option),
		);
		const win = options.management();
		if (
			!disposed &&
			snapshot._tag === "Some" &&
			win &&
			!win.isDestroyed() &&
			!win.webContents.isDestroyed() &&
			agentRequestAllowed(
				{
					senderId: win.webContents.id,
					frameURL: win.webContents.getURL(),
					mainFrame: true,
				},
				win.webContents.id,
				options.renderer,
			)
		)
			win.webContents.send(AGENTS_SNAPSHOT, snapshot.value);
	};
	const setup = runtime.runPromise(
		Effect.map(AgentsService, (service) => {
			const off = service.subscribe(() => {
				const work = send();
				pending.add(work);
				void work.finally(() => pending.delete(work));
			});
			const offProgress = service.subscribeProgress((progress) => {
				const win = options.management();
				if (
					!disposed &&
					win &&
					!win.isDestroyed() &&
					!win.webContents.isDestroyed() &&
					agentRequestAllowed(
						{
							senderId: win.webContents.id,
							frameURL: win.webContents.getURL(),
							mainFrame: true,
						},
						win.webContents.id,
						options.renderer,
					)
				)
					win.webContents.send(AGENTS_PROGRESS, progress);
			});
			return () => {
				off();
				offProgress();
			};
		}),
	);
	ipcMain.handle(AGENTS_REQUEST, async (event, input: unknown) => {
		if (disposed)
			return {
				_tag: "rejected",
				code: "AGENT.IPC.DISPOSED",
				message: "Agent management is closed",
			};
		const work = handler(
			{
				senderId: event.sender.id,
				frameURL: event.senderFrame?.url ?? "",
				mainFrame: event.senderFrame === event.sender.mainFrame,
			},
			input,
		);
		pending.add(work);
		try {
			return await work;
		} finally {
			pending.delete(work);
		}
	});
	return {
		runtime,
		dispose: async (): Promise<void> => {
			if (disposed) return;
			disposed = true;
			ipcMain.removeHandler(AGENTS_REQUEST);
			(await setup)();
			await Promise.allSettled([...pending]);
			await runtime.dispose();
		},
	};
}
