import type { ChannelRuntime } from "./channel-contracts.js";
import { RuntimeUnavailable } from "./integration-errors.js";
/** Explicit default: catalog/configuration work without claiming a running gateway. */
export const unavailableChannelRuntime = (): ChannelRuntime => ({
	status: async () => ({
		available: false,
		reason: "OpenClaw runtime is unavailable",
		connected: [],
	}),
	configure: async () => {
		throw new RuntimeUnavailable();
	},
	remove: async () => {
		throw new RuntimeUnavailable();
	},
	startQr: async () => {
		throw new RuntimeUnavailable();
	},
	pairings: async () => {
		throw new RuntimeUnavailable();
	},
	approve: async () => {
		throw new RuntimeUnavailable();
	},
});
