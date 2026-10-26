import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { app } from "electron";
import { AppLocale } from "../../../../../packages/edge/src/settings/settings-contracts";

/** Chromium flags and platform identity must precede ready and BrowserWindow. */
export function prepareDesktopStartup(platform = process.platform): void {
	if (platform === "win32") app.setAppUserModelId("net.roxasroot.open-quake");
	app.commandLine.appendSwitch(
		"disable-features",
		"CalculateNativeWinOcclusion",
	);
	try {
		const path = join(app.getPath("userData"), "settings-v1.json");
		if (statSync(path).size > 65536) return;
		const document: unknown = JSON.parse(readFileSync(path, "utf8"));
		const decoded = Schema.decodeUnknownOption(
			Schema.Struct({ locale: AppLocale }),
		)(document);
		if (decoded._tag === "Some")
			app.commandLine.appendSwitch("lang", decoded.value.locale);
	} catch {
		// The canonical settings owner reports corrupt records after startup.
	}
}
