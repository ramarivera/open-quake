import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";
import { RuntimeUnavailable } from "../../../../../packages/edge/src/channels/integration-errors";
import { agentCommandInvocation } from "./command-invocation";
export interface ChannelCommand {
	readonly args: readonly string[];
	readonly signal?: AbortSignal;
	readonly timeoutMs: number;
	readonly onLine?: (line: string) => void;
}
export type ChannelCommandRunner = (command: ChannelCommand) => Promise<string>;
/** Private state, fixed argv, no credential arguments. Windows batch shims use a quoted command processor. Never reads the user's default OpenClaw state. */
export function channelCommandRunner(
	executable: string,
	root: string,
): ChannelCommandRunner {
	return ({ args, signal, timeoutMs, onLine }) =>
		new Promise((resolve, reject) => {
			if (!isAbsolute(executable) || !isAbsolute(root) || signal?.aborted) {
				reject(new RuntimeUnavailable());
				return;
			}
			const [command, argv, spawnOptions] = agentCommandInvocation(
				executable,
				args,
			);
			const child = spawn(command, argv, {
				...spawnOptions,
				stdio: ["ignore", "pipe", "ignore"],
				env: {
					...process.env,
					OPENCLAW_STATE_DIR: root,
					OPENCLAW_CONFIG_PATH: `${root}/openclaw.json`,
					NO_COLOR: "1",
				},
			});
			let output = "",
				pending = "",
				settled = false;
			const finish = (ok: boolean) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				signal?.removeEventListener("abort", abort);
				if (ok) resolve(output);
				else reject(new RuntimeUnavailable());
			};
			const abort = () => {
				child.kill("SIGKILL");
				finish(false);
			};
			const timer = setTimeout(abort, timeoutMs);
			signal?.addEventListener("abort", abort, { once: true });
			child.stdout.on("data", (chunk: Buffer) => {
				output += chunk.toString("utf8");
				pending += chunk.toString("utf8");
				if (Buffer.byteLength(output) > 262144) {
					abort();
					return;
				}
				const lines = pending.split(/\r?\n/);
				pending = lines.pop() ?? "";
				for (const line of lines) onLine?.(line);
			});
			child.once("error", () => finish(false));
			child.once("close", (code) => {
				if (pending) onLine?.(pending);
				finish(code === 0);
			});
			if (signal?.aborted) abort();
		});
}
