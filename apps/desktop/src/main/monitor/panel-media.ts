import { Schema } from "effect";
import type {
	ProfileEnvelope,
	ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts";
import { MonitorSettings, StyleId } from "../../shared/monitor-contracts";
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
	const action = key.config.actions.find(
		(action) => action.type === "monitorStyle",
	);
	const parsed = Schema.decodeUnknownEither(
		Schema.Struct({
			styleId: StyleId,
			background: Schema.Struct({
				mode: Schema.Literal("style", "none", "custom"),
				themes: MonitorSettings.fields.media,
			}),
		}),
	)(action?.value);
	if (parsed._tag === "Left" || parsed.right.background.mode !== "custom")
		return;
	return parsed.right.background.themes[parsed.right.styleId];
}
