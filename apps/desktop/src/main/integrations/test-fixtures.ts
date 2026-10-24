import { Effect, Layer, ManagedRuntime } from "effect";
import type {
	ChannelId,
	ChannelRuntime,
	CredentialVault,
	JsonStore,
	Pairing,
} from "../../../../../packages/edge/src/channels/channel-contracts";
import {
	ChannelPorts,
	ChannelService,
} from "../../../../../packages/edge/src/channels/channel-service";
import {
	EMPTY_HA_STORE,
	type Entity,
	type HaConnection,
	type HaService,
} from "../../../../../packages/edge/src/home-assistant/ha-contracts";
import {
	HaPorts,
	HomeAssistantService,
} from "../../../../../packages/edge/src/home-assistant/ha-service";
import {
	ShortcutPorts,
	ShortcutService,
} from "../../../../../packages/edge/src/shortcuts/shortcut-service";
import { makeIntegrationController } from "./controller";
export const memoryStore = (initial: unknown) => {
	let data: unknown = structuredClone(initial);
	const writes: unknown[] = [];
	let fail = false;
	const port: JsonStore = {
		read: async () => structuredClone(data),
		write: async (value) => {
			if (fail) throw new TypeError("storage failed with secret-value");
			data = structuredClone(value);
			writes.push(data);
		},
	};
	return {
		port,
		writes,
		read: () => data,
		setFail: (value: boolean) => {
			fail = value;
		},
	};
};
export const fakeVault = () => {
	let next = 0;
	let failing = false;
	const values = new Map<string, string>();
	const port: CredentialVault = {
		put: async (value) => {
			const ref = `ref-${++next}`;
			values.set(ref, value);
			return ref;
		},
		get: async (ref) => {
			const value = values.get(ref);
			if (value === undefined) throw new TypeError("keychain unavailable");
			return value;
		},
		remove: async (ref) => {
			if (failing) throw new TypeError("keychain secret-value");
			values.delete(ref);
		},
	};
	return {
		port,
		values,
		failRemove: (value: boolean) => {
			failing = value;
		},
	};
};
export function fakeChannels() {
	let available = true;
	let removeUnavailable = false;
	const connected: ChannelId[] = [];
	const configured: unknown[] = [];
	const approvals: string[] = [];
	let cancelled = 0;
	let pending: Pairing[] = [{ code: "X7K2", sender: "Alice", createdAt: 1000 }];
	const callbacks = new Map<string, Parameters<ChannelRuntime["startQr"]>[2]>();
	const port: ChannelRuntime = {
		status: async () => ({
			available,
			reason: available ? "" : "OpenClaw runtime is unavailable",
			connected,
		}),
		configure: async (config, credentials) => {
			configured.push({ config, credentials });
		},
		remove: async () => {
			if (removeUnavailable) throw new TypeError("offline");
		},
		startQr: async (_id, session, receive) => {
			callbacks.set(session, receive);
			return () => {
				cancelled++;
			};
		},
		pairings: async () => pending,
		approve: async (id, code) => {
			approvals.push(`${id}:${code}`);
			await Promise.resolve();
			pending = pending.filter((p) => p.code !== code);
		},
	};
	return {
		port,
		configured,
		approvals,
		callbacks,
		connected,
		setRemoveUnavailable: (value: boolean) => {
			removeUnavailable = value;
		},
		setAvailable: (value: boolean) => {
			available = value;
		},
		cancelled: () => cancelled,
	};
}
export const entity: Entity = {
	entity_id: "light.desk",
	state: "off",
	attributes: { friendly_name: "Desk", brightness: 12 },
	area: "Study",
};
export const service: HaService = {
	domain: "light",
	service: "turn_on",
	name: "Turn on",
	fields: [
		{
			name: "brightness",
			label: "Brightness",
			required: true,
			type: "number",
			min: 0,
			max: 255,
			options: [],
		},
	],
};
export function integrationFixture(shared?: {
	channels: ReturnType<typeof memoryStore>;
	vault: ReturnType<typeof fakeVault>;
}) {
	let now = 1000;
	let next = 0;
	let model = '{"ConfigTitle":"Editing","ConfigData":[]}';
	const channels =
		shared?.channels ?? memoryStore({ version: 1, channels: [] });
	const shortcuts = memoryStore({ version: 1, libraries: [] });
	const ha = memoryStore(EMPTY_HA_STORE);
	const vault = shared?.vault ?? fakeVault();
	const runtimePort = fakeChannels();
	let entities: readonly Entity[] = [
		entity,
		{
			entity_id: "button.reset",
			state: "unknown",
			attributes: { friendly_name: "Reset" },
			area: "Other",
		},
	];
	const reads: string[][] = [];
	const executions: unknown[] = [];
	let failRead = false;
	let closes = 0;
	let openError: unknown;
	const connection: HaConnection = {
		entities: async () => entities,
		services: async () => [service],
		states: async (ids) => {
			reads.push([...ids]);
			if (failRead) throw new TypeError("network token=secret-value");
			return entities.filter((e) => ids.includes(e.entity_id));
		},
		execute: async (domain, service, data) => {
			executions.push({ domain, service, data });
		},
		close: () => {
			closes++;
		},
	};
	const placed: unknown[] = [];
	const live = Layer.mergeAll(
		ChannelService.Default.pipe(
			Layer.provide(
				Layer.succeed(ChannelPorts, {
					store: channels.port,
					vault: vault.port,
					runtime: runtimePort.port,
					now: () => now,
					id: () => `qr-${++next}`,
				}),
			),
		),
		ShortcutService.Default.pipe(
			Layer.provide(
				Layer.succeed(ShortcutPorts, {
					store: shortcuts.port,
					id: () => `shortcut-${++next}`,
					now: () => "2026-10-24",
					draft: async () => model,
					sync: async () => "profile-id",
				}),
			),
		),
		HomeAssistantService.Default.pipe(
			Layer.provide(
				Layer.succeed(HaPorts, {
					store: ha.port,
					vault: vault.port,
					open: async () => {
						if (openError) throw openError;
						return connection;
					},
					place: async (target, key) => {
						placed.push({ target, key });
					},
				}),
			),
		),
	);
	const runtime = ManagedRuntime.make(live);
	const opened: string[] = [];
	const controller = runtime.runPromise(
		makeIntegrationController({
			openExternal: async (url) => {
				opened.push(url);
			},
			targets: async () => [],
		}),
	);
	return {
		runtime,
		channels,
		shortcuts,
		ha,
		vault,
		runtimePort,
		reads,
		executions,
		placed,
		opened,
		request: async (input: unknown) =>
			(await controller).request(input).pipe(runtime.runPromise),
		now: (value: number) => {
			now = value;
		},
		model: (value: string) => {
			model = value;
		},
		entities: (value: readonly Entity[]) => {
			entities = value;
		},
		failRead: () => {
			failRead = true;
		},
		openError: (value: unknown) => {
			openError = value;
		},
		closes: () => closes,
		dispose: async () => {
			await runtime.runPromise(
				Effect.all([ChannelService.dispose(), HomeAssistantService.dispose()]),
			);
			await runtime.dispose();
		},
	};
}
