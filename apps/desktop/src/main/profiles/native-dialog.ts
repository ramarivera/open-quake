import { type BrowserWindow, dialog } from "electron";

/** Native sheets keep Electron's main loop alive; an unowned alert does not. */
export async function confirmProfileAction(
	owner: BrowserWindow | undefined,
	message: string,
	detail: string,
	timeoutMs = 60_000,
): Promise<boolean> {
	if (!owner || owner.isDestroyed()) return false;
	if (owner.isMinimized()) owner.restore();
	if (!owner.isVisible()) owner.show();
	owner.focus();
	const reply = await dialog.showMessageBox(owner, {
		type: "warning",
		message,
		detail,
		buttons: ["Confirm", "Cancel"],
		defaultId: 1,
		cancelId: 1,
		signal: AbortSignal.timeout(timeoutMs),
	});
	return reply.response === 0;
}
