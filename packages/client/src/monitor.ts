import { Option, Schema } from "effect";
import { MonitoringSnapshot } from "../../edge/src/monitor/monitor-config.js";

export interface MonitoringTransport {
	readonly snapshot: () => Promise<unknown>;
	readonly onState: (receive: (input: unknown) => void) => () => void;
}
/** Validate host messages at the consumer boundary. Unsubscribing drops late delivery. */
export const monitoringClient = (transport: MonitoringTransport) => ({
	snapshot: async (): Promise<MonitoringSnapshot> =>
		Schema.decodeUnknownSync(MonitoringSnapshot)(await transport.snapshot()),
	subscribe: (
		receive: (snapshot: MonitoringSnapshot) => void,
	): (() => void) => {
		let active = true;
		const off = transport.onState((input) => {
			const decoded = Schema.decodeUnknownOption(MonitoringSnapshot)(input);
			if (active && Option.isSome(decoded)) receive(decoded.value);
		});
		return () => {
			active = false;
			off();
		};
	},
});
