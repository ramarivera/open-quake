export * from "../../../../packages/edge/src/maintenance/contracts.js";

import type {
	MaintenanceCommand,
	MaintenanceReply,
} from "../../../../packages/edge/src/maintenance/contracts.js";
export interface MaintenanceBridge {
	readonly request: (command: MaintenanceCommand) => Promise<MaintenanceReply>;
}
declare global {
	interface Window {
		readonly quakeMaintenance?: MaintenanceBridge;
	}
}
