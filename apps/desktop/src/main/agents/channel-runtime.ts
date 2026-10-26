import { Schema } from "effect";
import {
	CHANNEL_CATALOG,
	channelDescriptor,
	credentialFields,
} from "../../../../../packages/edge/src/channels/channel-catalog";
import {
	type ChannelConfig,
	ChannelId,
	type ChannelRuntime,
	type Pairing,
} from "../../../../../packages/edge/src/channels/channel-contracts";
import {
	InputRejected,
	RuntimeUnavailable,
} from "../../../../../packages/edge/src/channels/integration-errors";
import { unavailableChannelRuntime } from "../../../../../packages/edge/src/channels/runtime-adapter";
import {
	type ChannelCommandRunner,
	channelCommandRunner,
} from "./channel-command";
import { createLocalAgentState, type LocalAgentState } from "./local-state";

const json = <A, I>(schema: Schema.Schema<A, I>, text: string): A =>
	Schema.decodeUnknownSync(Schema.parseJson(schema))(text);
const Account = Schema.Struct({
	connected: Schema.optional(Schema.Boolean),
	running: Schema.optional(Schema.Boolean),
	enabled: Schema.optional(Schema.Boolean),
	configured: Schema.optional(Schema.Boolean),
});
const Status = Schema.Struct({
	gatewayReachable: Schema.optional(Schema.Boolean),
	configOnly: Schema.optional(Schema.Boolean),
	channelAccounts: Schema.optional(
		Schema.Record({ key: Schema.String, value: Schema.Array(Account) }),
	),
});
const Installed = Schema.Struct({
	chat: Schema.Record({
		key: Schema.String,
		value: Schema.Struct({ installed: Schema.Boolean }),
	}),
});
const Pairings = Schema.Struct({
	channel: Schema.String,
	requests: Schema.Array(
		Schema.Struct({
			code: Schema.String,
			id: Schema.String,
			createdAt: Schema.String,
			meta: Schema.optional(
				Schema.Struct({ senderId: Schema.optional(Schema.String) }),
			),
		}),
	),
});
const Config = Schema.Struct({
	gateway: Schema.Struct({
		mode: Schema.Literal("local"),
		bind: Schema.Literal("loopback"),
		port: Schema.optional(Schema.Int.pipe(Schema.between(1, 65535))),
		auth: Schema.Struct({
			mode: Schema.Literal("token"),
			token: Schema.NonEmptyString,
		}),
	}),
	channels: Schema.Record({
		key: Schema.String.pipe(
			Schema.filter((value): boolean => Schema.is(ChannelId)(value)),
		),
		value: Schema.Record({
			key: Schema.String,
			value: Schema.Unknown,
		}),
	}),
	plugins: Schema.Struct({
		entries: Schema.Record({
			key: Schema.String,
			value: Schema.Unknown,
		}),
	}),
});
type Config = typeof Config.Type;
/** OpenClaw source 3cd1240: channels status/list/login and pairing list/approve. No HTTP control endpoints or plugin installer. */
export function createLocalChannelRuntime(options: {
	readonly root: string;
	readonly command?: string | undefined;
	readonly run?: ChannelCommandRunner;
	readonly storage?: LocalAgentState;
}): ChannelRuntime {
	if (!options.command && !options.run) return unavailableChannelRuntime();
	const storage = options.storage ?? createLocalAgentState(options.root);
	const run: ChannelCommandRunner =
		options.run ??
		(async (command) =>
			channelCommandRunner(
				options.command ?? "",
				await storage.stateDirectory(),
			)(command));
	const write = (mutate: (config: Config) => Config) =>
		storage.mutateConfig((value) => {
			const next = mutate(Schema.decodeUnknownSync(Config)(value));
			const plugins = Schema.decodeUnknownSync(
				Schema.Record({ key: Schema.String, value: Schema.Unknown }),
			)(value.plugins);
			return {
				...value,
				channels: next.channels,
				plugins: { ...plugins, entries: next.plugins.entries },
			};
		});
	const enablePlugin = (entries: Config["plugins"]["entries"], id: string) => ({
		...entries,
		[id]: {
			...Schema.decodeUnknownSync(
				Schema.Record({ key: Schema.String, value: Schema.Unknown }),
			)(entries[id] ?? {}),
			enabled: true,
		},
	});
	const installed = async (id: ChannelId) => {
		const entries = json(
			Installed,
			await run({
				args: ["channels", "list", "--all", "--json"],
				timeoutMs: 10000,
			}),
		);
		if (!entries.chat[id]?.installed) throw new RuntimeUnavailable();
	};
	const status: ChannelRuntime["status"] = async () => {
		await storage.mutateConfig((config) => config);
		const result = json(
			Status,
			await run({
				args: ["channels", "status", "--json", "--timeout", "10000"],
				timeoutMs: 12000,
			}),
		);
		const available =
			result.gatewayReachable !== false &&
			!result.configOnly &&
			!!result.channelAccounts;
		return {
			available,
			reason: available ? "" : "OpenClaw gateway is not ready",
			connected: available
				? CHANNEL_CATALOG.filter((d) =>
						result.channelAccounts?.[d.id]?.some(
							(a) => a.connected === true && a.enabled !== false,
						),
					).map((d) => d.id)
				: [],
		};
	};
	const configure = async (
		config: ChannelConfig,
		credentials: Readonly<Record<string, string>>,
	) => {
		const descriptor = channelDescriptor(config.id);
		if (!descriptor) throw new InputRejected(undefined, "channel");
		const allowed = credentialFields(config.id);
		const fields: Record<string, string | boolean> = {
			enabled: config.enabled,
		};
		for (const field of allowed) {
			const value = (
				field.secret ? credentials[field.key] : config.publicFields[field.key]
			)?.trim();
			if (!value || value.length > 8192)
				throw new InputRejected(undefined, field.label);
			fields[field.key] = value;
		}
		if (
			Object.keys(credentials).some(
				(key) => !allowed.some((f) => f.secret && f.key === key),
			)
		)
			throw new InputRejected(undefined, "credentials");
		if (config.id === "feishu") {
			if (!["feishu", "lark"].includes(config.publicFields.domain ?? ""))
				throw new InputRejected(undefined, "Domain");
			Object.assign(fields, {
				domain: config.publicFields.domain,
				dmPolicy: "pairing",
				groupPolicy: "allowlist",
				requireMention: true,
			});
		}
		if (descriptor.setupType === "qr_login") fields.dmPolicy = "pairing";
		await installed(config.id);
		await write((before) => ({
			...before,
			channels: { ...before.channels, [config.id]: fields },
			plugins: {
				entries: descriptor.pluginEntryId
					? enablePlugin(before.plugins.entries, descriptor.pluginEntryId)
					: before.plugins.entries,
			},
		}));
	};
	const pairings = async (id: ChannelId): Promise<readonly Pairing[]> => {
		const result = json(
			Pairings,
			await run({
				args: ["pairing", "list", "--channel", id, "--json"],
				timeoutMs: 10000,
			}),
		);
		if (result.channel !== id) throw new RuntimeUnavailable();
		return result.requests
			.map((r) => ({
				code: r.code,
				sender: r.meta?.senderId ?? r.id,
				createdAt: Date.parse(r.createdAt),
			}))
			.filter((r) => Number.isFinite(r.createdAt));
	};
	return {
		status,
		configure,
		remove: async (id) => {
			await run({
				args: ["channels", "remove", "--channel", id, "--delete"],
				timeoutMs: 10000,
			});
			await write((before) => ({
				...before,
				channels: Object.fromEntries(
					Object.entries(before.channels).filter(([key]) => key !== id),
				),
			}));
		},
		startQr: async (id, _session, receive) => {
			const descriptor = channelDescriptor(id);
			if (
				!descriptor ||
				!["qr_login", "credentials_or_qr"].includes(descriptor.setupType)
			)
				throw new InputRejected(undefined, "QR channel");
			if (!(await status()).available) throw new RuntimeUnavailable();
			await installed(id);
			await write((before) => ({
				...before,
				channels: {
					...before.channels,
					[id]: { ...before.channels[id], enabled: true, dmPolicy: "pairing" },
				},
				plugins: {
					entries: descriptor.pluginEntryId
						? enablePlugin(before.plugins.entries, descriptor.pluginEntryId)
						: before.plugins.entries,
				},
			}));
			const controller = new AbortController();
			let cancelled = false;
			const cancel = () => {
				cancelled = true;
				controller.abort();
			};
			void run({
				args: ["channels", "login", "--channel", id],
				signal: controller.signal,
				timeoutMs: 300000,
				onLine: (line) => {
					if (cancelled) return;
					const image = line.match(
						/data:image\/png;base64,[A-Za-z0-9+/=]+/,
					)?.[0];
					const url = line.match(/https:\/\/[^\s<>"']+/)?.[0];
					if (image || url)
						receive({ ...(image ? { image } : {}), ...(url ? { url } : {}) });
				},
			}).then(
				async () => {
					if (cancelled) return;
					try {
						const ready = await status();
						if (!cancelled)
							receive(
								ready.connected.includes(id)
									? { confirmed: true }
									: { failed: true },
							);
					} catch {
						if (!cancelled) receive({ failed: true });
					}
				},
				() => {
					if (!cancelled) receive({ failed: true });
				},
			);
			return cancel;
		},
		pairings,
		approve: async (id, code) => {
			if (
				!/^[A-Za-z0-9-]{1,80}$/.test(code) ||
				!(await pairings(id)).some((p) => p.code === code)
			)
				throw new InputRejected(undefined, "Pairing code");
			await run({
				args: ["pairing", "approve", "--channel", id, code],
				timeoutMs: 10000,
			});
		},
	};
}
