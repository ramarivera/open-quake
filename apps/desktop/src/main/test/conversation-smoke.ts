import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";

async function run() {
	assert.equal(process.env.OPEN_QUAKE_MOCK_DEVICE, "1");
	const scratch = process.env.OPEN_QUAKE_CONVERSATION_SCRATCH;
	assert(scratch && isAbsolute(scratch));
	mkdirSync(scratch, { recursive: true });
	const directory = mkdtempSync(join(scratch, "electron-"));
	app.setPath("userData", directory);
	app.setPath("sessionData", directory);
	app.disableHardwareAcceleration();
	// Explicit app.exit below owns the outcome after asynchronous cleanup.
	app.on("window-all-closed", () => {});
	if (process.platform === "darwin") app.setActivationPolicy("prohibited");
	const deadline = setTimeout(() => {
		process.stderr.write("Conversation smoke timed out\n");
		app.exit(1);
	}, 90_000);
	let panel: BrowserWindow | undefined;
	try {
		await app.whenReady();
		panel = new BrowserWindow({
			show: false,
			focusable: false,
			enableLargerThanScreen: true,
			useContentSize: true,
			width: 1920,
			height: 1080,
			webPreferences: {
				nodeIntegration: true,
				contextIsolation: false,
				sandbox: false,
			},
		});
		panel.webContents.setAudioMuted(true);
		panel.webContents.on("console-message", (details) => {
			if (details.level === "error")
				process.stderr.write(`${details.message}\n`);
		});
		// Node access is restricted to this hidden test document, never the app's renderer.
		const finished = new Promise<number>((resolve, reject) => {
			ipcMain.once(
				"conversation-smoke-result",
				(_event, result: { passed: number; error?: string }) =>
					result.error
						? reject(new Error(result.error))
						: resolve(result.passed),
			);
		});
		ipcMain.handle(
			"conversation-smoke-capture",
			async (_event, locale: string) => {
				assert(locale === "en" || locale === "de");
				assert(panel);
				const image = await panel.webContents.capturePage({
					x: 0,
					y: 0,
					width: 1920,
					height: 480,
				});
				assert.deepEqual(image.getSize(), { width: 1920, height: 480 });
				const { writeFile } = await import("node:fs/promises");
				await writeFile(
					join(scratch, `conversation-${locale}.png`),
					image.toPNG(),
				);
			},
		);
		await panel.loadFile(
			resolve(
				import.meta.dirname,
				"../conversation-smoke-renderer/conversation-smoke.html",
			),
		);
		const passed = await finished;
		process.stdout.write(
			`Conversation smoke PASS: ${passed} mounted scenarios; EN/DE captures; no hardware, microphone or provider.\n`,
		);
	} catch (error) {
		process.stderr.write(
			`${error instanceof Error ? error.stack : String(error)}\n`,
		);
		process.exitCode = 1;
	} finally {
		clearTimeout(deadline);
		panel?.destroy();
		await rm(directory, { recursive: true });
		app.exit(process.exitCode ? 1 : 0);
	}
}
void run().catch((error: unknown) => {
	process.stderr.write(`${String(error)}\n`);
	app.exit(1);
});
