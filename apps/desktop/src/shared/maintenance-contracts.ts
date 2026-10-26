export * from "../../../../packages/edge/src/maintenance/contracts.js";

import type {
	FirmwareSnapshot,
	MaintenanceCommand,
	MaintenanceReply,
} from "../../../../packages/edge/src/maintenance/contracts.js";
export const FIRMWARE_PROGRESS_CHANNEL = "maintenance:firmware-progress";
export interface MaintenanceBridge {
	readonly subscribeFirmware?: (
		listener: (snapshot: FirmwareSnapshot) => void,
	) => () => void;
	readonly request: (command: MaintenanceCommand) => Promise<MaintenanceReply>;
}
declare global {
	interface Window {
		readonly quakeMaintenance?: MaintenanceBridge;
	}
}
