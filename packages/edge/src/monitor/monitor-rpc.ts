import { Rpc, RpcGroup } from "@effect/rpc";
import { Schema } from "effect";
import { MonitoringSnapshot } from "./monitor-config.js";
export const MonitoringRpcs = RpcGroup.make(
	Rpc.make("monitoring.snapshot", {
		payload: { _tag: Schema.Literal("snapshot") },
		success: MonitoringSnapshot,
	}),
);
export { RpcClient, RpcClientError, RpcServer } from "@effect/rpc";
export type {
	FromClientEncoded,
	FromServerEncoded,
} from "@effect/rpc/RpcMessage";
