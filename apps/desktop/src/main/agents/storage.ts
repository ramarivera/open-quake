import { randomUUID } from "node:crypto";
import {
	lstat,
	mkdir,
	open,
	readdir,
	readFile,
	realpath,
	rename,
	rm,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { Effect, Option, Schema } from "effect";
import { AgentState } from "../../../../../packages/edge/src/agents/agents-contracts.js";
import { AgentStorageFailed } from "../../../../../packages/edge/src/agents/agents-errors.js";
import type { AgentStoragePort } from "../../../../../packages/edge/src/agents/agents-repository.js";

const missing = (cause: unknown): boolean =>
	cause instanceof Error && "code" in cause && cause.code === "ENOENT";
const ownerValid = (state: AgentState, owner: string): boolean =>
	owner === "" || state.agents.some((a) => a.id === owner);
/** One pointer commits catalog + Markdown + skill locations together. Incomplete generations are never visible. */
export function createAgentStorage(
	root: string,
	hooks: { readonly beforeCommit?: () => Promise<void> } = {},
): AgentStoragePort & {
	readonly cleanupFailures: readonly AgentStorageFailed[];
} {
	const cleanupFailures: AgentStorageFailed[] = [];
	const initialize = async (): Promise<void> => {
		await mkdir(root, { recursive: true, mode: 0o700 });
		if (
			(await lstat(root)).isSymbolicLink() ||
			(await realpath(root)) !== resolve(root)
		)
			throw new AgentStorageFailed();
	};
	const durableFile = async (path: string, content: string): Promise<void> => {
		const fd = await open(path, "wx", 0o600);
		try {
			await fd.writeFile(content, "utf8");
			await fd.sync();
		} finally {
			await fd.close();
		}
	};
	const skillPath = (
		generation: string,
		owner: string,
		folder: string,
	): string =>
		owner
			? join(generation, "workspaces", owner, "skills", folder, "SKILL.md")
			: join(generation, "skills", folder, "SKILL.md");
	const read = async (): Promise<Option.Option<unknown>> => {
		await initialize();
		let generation: string;
		try {
			generation = await readFile(join(root, "current"), "utf8");
		} catch (cause) {
			if (missing(cause)) return Option.none();
			throw cause;
		}
		if (!/^[0-9a-f-]{36}$/.test(generation)) throw new AgentStorageFailed();
		const base = join(root, generation);
		const state = Schema.decodeUnknownSync(AgentState)(
			JSON.parse(await readFile(join(base, "state.json"), "utf8")),
		);
		for (const agent of state.agents)
			for (const [file, content] of Object.entries(agent.files))
				if (
					(await readFile(join(base, "workspaces", agent.id, file), "utf8")) !==
					content
				)
					throw new AgentStorageFailed();
		for (const skill of state.skills) {
			if (
				!ownerValid(state, skill.owner) ||
				(await readFile(skillPath(base, skill.owner, skill.folder), "utf8")) !==
					skill.content
			)
				throw new AgentStorageFailed();
		}
		return Option.some(state);
	};
	const write = async (input: AgentState): Promise<void> => {
		const state = Schema.decodeUnknownSync(AgentState)(input);
		if (state.skills.some((s) => !ownerValid(state, s.owner)))
			throw new AgentStorageFailed();
		await initialize();
		const id = randomUUID(),
			base = join(root, id),
			pointer = join(root, `pointer-${id}`);
		let committed = false;
		await mkdir(base, { mode: 0o700 });
		try {
			for (const agent of state.agents) {
				const workspace = join(base, "workspaces", agent.id);
				await mkdir(workspace, { recursive: true, mode: 0o700 });
				for (const [file, content] of Object.entries(agent.files))
					await durableFile(join(workspace, file), content);
			}
			for (const skill of state.skills) {
				const path = skillPath(base, skill.owner, skill.folder);
				await mkdir(join(path, ".."), { recursive: true, mode: 0o700 });
				await durableFile(path, skill.content);
			}
			await durableFile(
				join(base, "state.json"),
				JSON.stringify(Schema.encodeSync(AgentState)(state)),
			);
			await durableFile(pointer, id);
			await hooks.beforeCommit?.();
			await rename(pointer, join(root, "current"));
			committed = true;
		} finally {
			if (!committed) {
				await rm(pointer, { force: true });
				await rm(base, { recursive: true, force: true });
			}
		}
		// Obsolete generations are no longer reachable. Remove their workspaces after
		// committing, while retaining cleanup failures separately from commit failures.
		try {
			for (const entry of await readdir(root))
				if (entry !== id && /^[0-9a-f-]{36}$/.test(entry))
					await rm(join(root, entry), { recursive: true, force: true });
		} catch (cause) {
			cleanupFailures.push(new AgentStorageFailed(cause));
		}
	};
	return {
		cleanupFailures,
		read: () =>
			Effect.tryPromise({
				try: read,
				catch: (cause) => new AgentStorageFailed(cause),
			}),
		write: (state) =>
			Effect.tryPromise({
				try: () => write(state),
				catch: (cause) => new AgentStorageFailed(cause),
			}),
	};
}
