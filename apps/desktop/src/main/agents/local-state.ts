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
import { Schema } from "effect";
import {
	AgentInvalid,
	AgentStorageFailed,
} from "../../../../../packages/edge/src/agents/agents-errors";
import { ServiceSettings } from "../../../../../packages/edge/src/agents/service-settings-contracts";

const ObjectValue = Schema.Record({
	key: Schema.String,
	value: Schema.Unknown,
});
const Gateway = Schema.Struct({
	mode: Schema.Literal("local"),
	bind: Schema.Literal("loopback"),
	port: Schema.optional(Schema.Int.pipe(Schema.between(1, 65535))),
	auth: Schema.Struct({
		mode: Schema.Literal("token"),
		token: Schema.NonEmptyString,
	}),
});
/** One private state owner shared by process administration and channel configuration. */
export function createLocalAgentState(path: string) {
	const root = resolve(path);
	let writing = Promise.resolve();
	const exclusive = <A>(work: () => Promise<A>): Promise<A> => {
		const result = writing.then(work);
		writing = result.then(
			() => {},
			() => {},
		);
		return result;
	};
	const directory = async (path: string) => {
		await mkdir(path, { recursive: true, mode: 0o700 });
		if ((await lstat(path)).isSymbolicLink() || (await realpath(path)) !== path)
			throw new AgentStorageFailed();
	};
	const validateDirectory = (path: string) => {
		if (
			path !== root &&
			!/^[A-Za-z0-9_-]{1,64}$/.test(path.slice(join(root, "data").length + 1))
		)
			throw new AgentInvalid();
		if (path !== root && !path.startsWith(`${join(root, "data")}/`))
			throw new AgentInvalid();
	};
	const defaults: typeof ServiceSettings.Type = {
		port: 18789,
		logLevel: "info",
		autoStart: false,
		dataDirectory: root,
	};
	const readSettings = async () => {
		await directory(root);
		try {
			const settings = Schema.decodeUnknownSync(
				Schema.parseJson(ServiceSettings),
			)(await readFile(join(root, "service-settings.json"), "utf8"));
			validateDirectory(settings.dataDirectory);
			return settings;
		} catch (cause) {
			if (cause instanceof Error && "code" in cause && cause.code === "ENOENT")
				return defaults;
			throw new AgentStorageFailed(cause);
		}
	};
	const atomic = async (path: string, value: unknown) => {
		const staging = `${path}.${randomUUID()}.pending`;
		try {
			const file = await open(staging, "wx", 0o600);
			try {
				await file.writeFile(JSON.stringify(value));
				await file.sync();
			} finally {
				await file.close();
			}
			await rename(staging, path);
		} finally {
			await rm(staging, { force: true });
		}
	};
	const stateDirectory = async () => {
		const settings = await readSettings();
		if (settings.dataDirectory !== root) await directory(join(root, "data"));
		await directory(settings.dataDirectory);
		return settings.dataDirectory;
	};
	const mutateConfig = (
		mutate: (config: Record<string, unknown>) => Record<string, unknown>,
	) =>
		exclusive(async () => {
			const data = await stateDirectory();
			let value: Record<string, unknown>;
			try {
				value = Schema.decodeUnknownSync(Schema.parseJson(ObjectValue))(
					await readFile(join(data, "openclaw.json"), "utf8"),
				);
			} catch (cause) {
				if (
					!(
						cause instanceof Error &&
						"code" in cause &&
						cause.code === "ENOENT"
					)
				)
					throw new AgentStorageFailed(cause);
				value = {
					gateway: {
						mode: "local",
						bind: "loopback",
						auth: { mode: "token", token: randomUUID() },
					},
					channels: {},
					plugins: { entries: {} },
				};
			}
			const next = mutate(value);
			Schema.decodeUnknownSync(Gateway)(next.gateway);
			await atomic(join(data, "openclaw.json"), next);
		});
	return {
		root,
		readSettings,
		stateDirectory,
		mutateConfig,
		saveSettings: (settings: typeof ServiceSettings.Type) =>
			exclusive(async () => {
				Schema.decodeUnknownSync(ServiceSettings)(settings, {
					onExcessProperty: "error",
				});
				validateDirectory(settings.dataDirectory);
				await directory(root);
				if (settings.dataDirectory !== root)
					await directory(join(root, "data"));
				await directory(settings.dataDirectory);
				await atomic(join(root, "service-settings.json"), settings);
			}),
		clear: () =>
			exclusive(async () => {
				const data = await stateDirectory();
				for (const entry of await readdir(data)) {
					if (
						data === root &&
						(entry === "service-settings.json" || entry === "data")
					)
						continue;
					await rm(join(data, entry), { recursive: true, force: true });
				}
			}),
	};
}
export type LocalAgentState = ReturnType<typeof createLocalAgentState>;
