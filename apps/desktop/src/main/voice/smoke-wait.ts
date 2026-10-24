import type { BrowserWindow } from "electron";

/** Native renderer readiness, independent of main-process scheduling latency. */
export async function waitForVoice(
	panel: BrowserWindow,
	condition: string,
): Promise<void> {
	await panel.webContents.executeJavaScript(`new Promise((resolve, reject) => {
		const deadline = Date.now() + 15000;
		const check = () => {
			if (${condition}) return resolve();
			if (Date.now() >= deadline) return reject(new Error('Voice smoke condition timed out: ' + ${JSON.stringify(condition)} + '\\n' + document.body.innerText));
			setTimeout(check, 50);
		};
		check();
	})`);
}
