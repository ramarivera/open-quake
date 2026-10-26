import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
	detectLocalObs,
	obsSettingsDirectory,
	parseObsSettings,
} from "./detection";

it("reads the recovered INI section, respects auth-disabled and rejects invalid ports", () => {
	expect(
		parseObsSettings(
			"[Other]\nServerPort=1\n[WebSocketServer]\nServerEnabled=true\nServerPort=4456\nServerPassword=fixture-password\n",
		),
	).toEqual({ port: 4456, password: "fixture-password" });
	expect(
		parseObsSettings(
			"[WebSocketServer]\nServerEnabled=true\nAuthRequired=false\nServerPassword=unused\n",
		),
	).toEqual({ port: 4455, password: "" });
	for (const port of ["0", "65536", "1x", "NaN"])
		expect(
			parseObsSettings(
				`[WebSocketServer]\nServerEnabled=true\nServerPort=${port}`,
			),
		).toBeUndefined();
	expect(
		parseObsSettings("[WebSocketServer]\nServerEnabled=false\nServerPort=4455"),
	).toBeUndefined();
});
it("selects only the platform-local OBS directory", () => {
	expect(obsSettingsDirectory("darwin", "/home/test", {})).toBe(
		"/home/test/Library/Application Support/obs-studio",
	);
	expect(
		obsSettingsDirectory("linux", "/home/test", { XDG_CONFIG_HOME: "/config" }),
	).toBe("/config/obs-studio");
	expect(
		obsSettingsDirectory("win32", "/home/test", { APPDATA: "/roaming" }),
	).toBe("/roaming/obs-studio");
});
it("detects only local files and supports modern plugin config without launching OBS", async () => {
	const root = await mkdtemp(join(tmpdir(), "obs-detection-"));
	try {
		expect(await detectLocalObs(root)).toBeUndefined();
		await mkdir(join(root, "plugin_config", "obs-websocket"), {
			recursive: true,
		});
		const path = join(root, "plugin_config", "obs-websocket", "config.json");
		await writeFile(
			path,
			JSON.stringify({
				server_enabled: true,
				server_port: 4457,
				server_password: "fixture-secret",
				auth_required: true,
			}),
		);
		expect(await detectLocalObs(root)).toEqual({
			source: path,
			port: 4457,
			password: "fixture-secret",
		});
		await writeFile(
			join(root, "global.ini"),
			"[WebSocketServer]\nServerEnabled=true\nServerPort=4458\nServerPassword=ini-secret",
		);
		expect((await detectLocalObs(root))?.port).toBe(4458);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
