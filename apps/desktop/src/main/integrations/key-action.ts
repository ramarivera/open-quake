import type { ProfileKey } from "../../../../../packages/device/src/profiles/profile-contracts";
import { InputRejected } from "../../../../../packages/edge/src/channels/integration-errors";
import type { HaKey } from "../../../../../packages/edge/src/home-assistant/ha-contracts";
import { keyHaConfig } from "./profiles";

/** Direct saved keys use their explicit configuration, independently of AI access. */
export const integrationKeyAction =
	(execute: (key: HaKey, signal: AbortSignal) => Promise<void>) =>
	async (key: ProfileKey, signal: AbortSignal): Promise<boolean> => {
		if (key.config.type !== "homeAssistant") return false;
		const config = keyHaConfig(key);
		if (!config) throw new InputRejected(undefined, "Home Assistant key");
		await execute(config, signal);
		return true;
	};
