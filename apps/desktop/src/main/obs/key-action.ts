import {
	isObsId,
	type ObsCommand,
	obsCommandFromKey,
} from "../../../../../packages/device/src/actions/obs-contracts";
import type { ProfileKey } from "../../../../../packages/device/src/profiles/profile-contracts";
import { ObsConfigurationRejected } from "../../../../../packages/edge/src/obs/obs-errors";
export const obsKeyAction =
	(execute: (command: ObsCommand, signal: AbortSignal) => Promise<void>) =>
	async (key: ProfileKey, signal: AbortSignal): Promise<boolean> => {
		if (!isObsId(key.config.type)) return false;
		const command = obsCommandFromKey(key);
		if (command._tag === "Left")
			throw new ObsConfigurationRejected(command.left);
		await execute(command.right, signal);
		return true;
	};
