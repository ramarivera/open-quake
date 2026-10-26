import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ObsDetection } from "../../../../../packages/edge/src/obs/obs-contracts";
/** Reads only local OBS settings. It never probes processes or starts OBS. */
export function parseObsSettings(
	text: string,
): Omit<ObsDetection, "source"> | undefined {
	let section = false;
	const values = new Map<string, string>();
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (line.startsWith("[") && line.endsWith("]")) {
			// obs-websocket writes [OBSWebSocket]; DK-Suite only reads [WebSocketServer].
			section = line === "[OBSWebSocket]" || line === "[WebSocketServer]";
			continue;
		}
		if (!section || line.startsWith(";") || line.startsWith("#")) continue;
		const split = line.indexOf("=");
		if (split >= 0)
			values.set(line.slice(0, split).trim(), line.slice(split + 1).trim());
	}
	const port = Number(values.get("ServerPort") ?? "4455");
	if (
		values.get("ServerEnabled")?.toLowerCase() !== "true" ||
		!Number.isInteger(port) ||
		port < 1 ||
		port > 65535
	)
		return undefined;
	return {
		port,
		password:
			values.get("AuthRequired")?.toLowerCase() === "false"
				? ""
				: (values.get("ServerPassword") ?? ""),
	};
}
export const obsSettingsDirectory = (
	platform: string,
	home: string,
	environment: NodeJS.ProcessEnv,
): string =>
	platform === "darwin"
		? join(home, "Library", "Application Support", "obs-studio")
		: platform === "win32"
			? join(
					environment.APPDATA ?? join(home, "AppData", "Roaming"),
					"obs-studio",
				)
			: join(
					environment.XDG_CONFIG_HOME ?? join(home, ".config"),
					"obs-studio",
				);
export async function detectLocalObs(
	directory = obsSettingsDirectory(process.platform, homedir(), process.env),
): Promise<ObsDetection | undefined> {
	for (const source of [
		join(directory, "global.ini"),
		join(directory, "plugin_config", "obs-websocket", "config.json"),
	]) {
		try {
			if ((await stat(source)).size > 64 * 1024) continue;
			const text = await readFile(source, "utf8");
			if (text.length > 64 * 1024) continue;
			if (source.endsWith(".ini")) {
				const settings = parseObsSettings(text);
				if (settings) return { ...settings, source };
			} else {
				const settings: unknown = JSON.parse(text);
				if (
					typeof settings !== "object" ||
					settings === null ||
					!("server_enabled" in settings) ||
					settings.server_enabled !== true ||
					!("server_port" in settings) ||
					typeof settings.server_port !== "number" ||
					!Number.isInteger(settings.server_port) ||
					settings.server_port < 1 ||
					settings.server_port > 65535
				)
					continue;
				const password =
					"server_password" in settings &&
					typeof settings.server_password === "string"
						? settings.server_password
						: "";
				return {
					port: settings.server_port,
					password:
						"auth_required" in settings && settings.auth_required === false
							? ""
							: password,
					source,
				};
			}
		} catch (cause) {
			if (cause instanceof SyntaxError) continue;
			if (cause instanceof Error && "code" in cause && cause.code === "ENOENT")
				continue;
			throw cause;
		}
	}
	return undefined;
}
