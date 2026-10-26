import { ipcMain, shell } from "electron";
import { MANAGEMENT_EXTERNAL } from "../../shared/management";
import { isManagementExternalLink } from "../../shared/management-external";
import { isAppRenderer } from "../profiles/profile-ipc";

interface NavigationContents {
	readonly mainFrame: { readonly url: string };
	on(
		event: "will-navigate" | "will-frame-navigate",
		listener: (event: { preventDefault(): void }, url: string) => void,
	): unknown;
	once(event: "destroyed", listener: () => void): unknown;
	setWindowOpenHandler(
		handler: (details: { readonly url: string }) => { action: "deny" },
	): void;
}
export function registerManagementNavigation(
	contents: NavigationContents,
	renderer: string,
): void {
	const block = (event: { preventDefault(): void }) => event.preventDefault();
	contents.on("will-navigate", block);
	contents.on("will-frame-navigate", block);
	// Popups lack a trustworthy initiating frame/gesture, so they never open externally.
	contents.setWindowOpenHandler(() => ({ action: "deny" }));
	const open = (event: Electron.IpcMainEvent, value: unknown) => {
		if (
			event.sender !== contents ||
			event.senderFrame !== contents.mainFrame ||
			!isAppRenderer(event.senderFrame?.url ?? "", renderer) ||
			new URL(event.senderFrame?.url ?? renderer).searchParams.get(
				"surface",
			) !== "management" ||
			!isManagementExternalLink(value)
		)
			return;
		void shell.openExternal(value).catch(() => {});
	};
	ipcMain.on(MANAGEMENT_EXTERNAL, open);
	contents.once("destroyed", () =>
		ipcMain.removeListener(MANAGEMENT_EXTERNAL, open),
	);
}
