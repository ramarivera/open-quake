import type { LibraryPack } from "../../shared/key-library";
import {
	type ForegroundArtwork,
	MONITOR_STATE,
	type MonitoringSnapshot,
} from "../../shared/monitor-contracts";
export type MonitorSend = (channel: string, value: unknown) => void;
/** Only management may receive the private foreground snapshot. */
export function publishMonitoringState(
	snapshot: MonitoringSnapshot,
	management: MonitorSend,
	_panel: MonitorSend,
): void {
	management(MONITOR_STATE, snapshot);
}
export const foregroundIdentity = (path: string): string =>
	(
		/^(.*?\.app)(?:\/|$)/i.exec(path.replaceAll("\\", "/"))?.[1] ??
		path.replaceAll("\\", "/")
	).toLowerCase();
/** Resolve in main so neither native paths nor catalog metadata reach the panel. */
export function foregroundArtwork(load: () => Promise<LibraryPack>) {
	return async (snapshot: MonitoringSnapshot): Promise<ForegroundArtwork> => {
		const foreground = snapshot.foreground;
		if (foreground.state !== "available" || !foreground.window)
			return { artwork: "" };
		const identity = foregroundIdentity(foreground.window.path);
		try {
			const pack = await load();
			return {
				artwork:
					pack.icons.find((icon) =>
						icon.extraData?.some(
							(path) => foregroundIdentity(path) === identity,
						),
					)?.data ?? "",
			};
		} catch {
			return { artwork: "" };
		}
	};
}
