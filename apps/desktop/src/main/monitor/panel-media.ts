import type {
	ProfileEnvelope,
	ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts";
import { monitorKeySettings } from "../../shared/monitor-key-settings";
import { selectStripPage } from "../../shared/strip-selection";
export function activeMonitorKey(
	envelope: ProfileEnvelope,
	serial: string,
	keyCode: string,
): ProfileKey | undefined {
	const { page } = selectStripPage(envelope, serial);
	return page.keys.find(
		(key) =>
			key.keyCode === keyCode &&
			key.config.display &&
			key.config.type === "systemMonitorPanel",
	);
}

export function monitorPanelSlot(key: ProfileKey | undefined) {
	if (key?.config.type !== "systemMonitorPanel" || !key.config.display) return;
	const settings = monitorKeySettings(key);
	return settings.background === "custom"
		? settings.media[settings.styleId]
		: undefined;
}
