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
export const foregroundKey = (snapshot: MonitoringSnapshot): string =>
	snapshot.foreground.state === "available" && snapshot.foreground.window
		? `available:${foregroundIdentity(snapshot.foreground.window.path)}`
		: snapshot.foreground.state;

export function foregroundArtwork(load: () => Promise<LibraryPack>) {
	let previous: string | undefined;
	let pending: Promise<ForegroundArtwork> | undefined;
	return (snapshot: MonitoringSnapshot): Promise<ForegroundArtwork> => {
		const identity = foregroundKey(snapshot);
		if (identity === previous && pending) return pending;
		previous = identity;
		pending = (async (): Promise<ForegroundArtwork> => {
			if (!identity.startsWith("available:")) return { artwork: "" };
			try {
				const pack = await load();
				return {
					artwork:
						pack.icons.find((icon) =>
							icon.extraData?.some(
								(path) => `available:${foregroundIdentity(path)}` === identity,
							),
						)?.data ?? "",
				};
			} catch {
				return { artwork: "" };
			}
		})();
		return pending;
	};
}
