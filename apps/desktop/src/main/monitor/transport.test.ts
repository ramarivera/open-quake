import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { describe, expect, it } from "vitest";
import { monitoringClient } from "../../../../../packages/client/src/monitor";
import { monitoringDefaults } from "../../../../../packages/edge/src/monitor/monitor-config";
import { MonitorCollector } from "../../../../../packages/edge/src/monitor/monitor-service";
import {
	MonitorForeground,
	MonitoringService,
} from "../../../../../packages/edge/src/monitor/monitoring-service";
import {
	MONITOR_STATE,
	MONITOR_STATE_REQUEST,
} from "../../shared/monitor-contracts";
import { decodeMonitoringRequest, handleMonitoringRequest } from "./rpc";
import { createMonitoringStateBridge } from "./state-preload";

it("round-trips actual RPC/preload/client snapshots with isolated validated subscriptions", async () => {
	const runtime = ManagedRuntime.make(
		MonitoringService.Default.pipe(
			Layer.provide(
				Layer.succeed(MonitorCollector, {
					collect: () =>
						Effect.succeed({ state: "available", values: { load: 17 } }),
				}),
			),
			Layer.provide(
				Layer.succeed(MonitorForeground, {
					pollMillis: 2000,
					stop: () => Effect.void,
					query: () => Effect.succeed(Option.none()),
				}),
			),
		),
	);
	const listeners = new Set<(event: unknown, input: unknown) => void>();
	const ipc = {
		invoke: async (channel: string, input?: unknown) => {
			expect(channel).toBe(MONITOR_STATE_REQUEST);
			const message = decodeMonitoringRequest(input);
			if (!message) throw new Error("Invalid envelope");
			return runtime.runPromise(handleMonitoringRequest(message));
		},
		on: (
			channel: string,
			listener: (event: unknown, input: unknown) => void,
		) => {
			expect(channel).toBe(MONITOR_STATE);
			listeners.add(listener);
		},
		removeListener: (
			_channel: string,
			listener: (event: unknown, input: unknown) => void,
		) => {
			listeners.delete(listener);
		},
	};
	const bridge = createMonitoringStateBridge(ipc);
	const client = monitoringClient({
		snapshot: bridge.snapshot,
		onState: bridge.subscribe,
	});
	let received = 0;
	const off = client.subscribe(() => received++);
	try {
		await runtime.runPromise(
			MonitoringService.configure(
				{ ...monitoringDefaults(), enabled: false },
				false,
			),
		);
		const snapshot = await client.snapshot();
		expect(snapshot.foreground.state).toBe("disabled");
		for (const listener of listeners) {
			listener({}, snapshot);
			listener({}, { invalid: true });
		}
		expect(received).toBe(1);
		off();
		for (const listener of listeners) listener({}, snapshot);
		expect(received).toBe(1);
	} finally {
		await bridge.dispose();
		await runtime.dispose();
	}
	expect(listeners.size).toBe(0);
});
describe("monitoring RPC authority", () => {
	it("rejects unknown calls and forged payloads, ignores supplied tracing authority", () => {
		const base = {
			_tag: "Request",
			id: "1",
			tag: "monitoring.snapshot",
			payload: { _tag: "snapshot" },
			headers: [["traceId", "forged"]],
		};
		expect(decodeMonitoringRequest(base)).toMatchObject({ headers: [] });
		expect(
			decodeMonitoringRequest({ ...base, tag: "monitoring.execute" }),
		).toBeUndefined();
		expect(
			decodeMonitoringRequest({
				...base,
				payload: { _tag: "snapshot", owner: "forged" },
			}),
		).toBeUndefined();
	});
});

it("rejects malformed or refused host responses without hanging a renderer", async () => {
	for (const response of [
		undefined,
		{},
		{ _tag: "Exit", requestId: "wrong", exit: { _tag: "Success", value: {} } },
	]) {
		const bridge = createMonitoringStateBridge({
			invoke: async () => response,
			on: () => {},
			removeListener: () => {},
		});
		try {
			await expect(bridge.snapshot()).rejects.toMatchObject({
				_tag: "RpcClientError",
				reason: "Protocol",
			});
		} finally {
			await bridge.dispose();
		}
	}
});

it("returns a plain cloneable rejection without private host causes", async () => {
	const bridge = createMonitoringStateBridge({
		invoke: async () => {
			throw new Error("private foreground details");
		},
		on: () => {},
		removeListener: () => {},
	});
	try {
		const failure: unknown = await bridge
			.snapshot()
			.catch((error: unknown) => error);
		expect(Object.getPrototypeOf(failure)).toBe(Object.prototype);
		expect(structuredClone(failure)).toEqual({
			_tag: "RpcClientError",
			reason: "Protocol",
			message: "Monitoring transport unavailable",
		});
		expect(JSON.stringify(failure)).not.toContain("private foreground");
	} finally {
		await bridge.dispose();
	}
});
