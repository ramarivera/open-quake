import { fileURLToPath } from "node:url";
import { BrowserWindow, type Display, type Rectangle } from "electron";
import { panelBounds } from "../display";

export interface PanelTarget {
	readonly display: Display;
	readonly isPanel: boolean;
}
const owners = new WeakMap<BrowserWindow, ReturnType<typeof manage>>();

function manage(win: BrowserWindow, initial: PanelTarget, platform: string) {
	let target = initial;
	let ready = !initial.isPanel;
	let requested = false;
	let disposed = false;
	let shield: BrowserWindow | undefined;
	let hiddenBounds: Rectangle | undefined;
	let closedBounds: Rectangle | undefined;
	const timers = new Set<ReturnType<typeof setTimeout>>();
	const later = (ms: number, action: () => void) => {
		const timer = setTimeout(() => {
			timers.delete(timer);
			if (!disposed && !win.isDestroyed()) action();
		}, ms);
		timers.add(timer);
	};
	const clearShield = () => {
		if (shield && !shield.isDestroyed()) shield.destroy();
		shield = undefined;
	};
	const top = () => {
		if (!target.isPanel || win.isDestroyed()) return;
		win.setAlwaysOnTop(true, "screen-saver", platform === "darwin" ? 1 : 0);
		win.moveTop();
	};
	const place = (next: PanelTarget) => {
		target = next;
		const bounds = panelBounds(next.display, next.isPanel);
		win.setBounds(bounds);
		shield?.setBounds(bounds);
		win.setAlwaysOnTop(next.isPanel, "screen-saver");
		const vertical = next.display.size.height > next.display.size.width;
		win.webContents.setZoomFactor(
			next.isPanel
				? Math.min(
						bounds.width / (vertical ? 480 : 1920),
						bounds.height / (vertical ? 1920 : 480),
					)
				: 1,
		);
	};
	const reveal = () => {
		if (!requested || !ready || disposed || win.isDestroyed()) return;
		place(target);
		win.setOpacity(1);
		win.showInactive();
		top();
		if (shield) later(350, clearShield);
		if (platform === "darwin" && target.isPanel) {
			later(50, () => {
				if (requested) top();
			});
			later(800, () => {
				if (requested) top();
			});
		}
	};
	const show = () => {
		if (disposed || win.isDestroyed()) return;
		const wasRequested = requested;
		requested = true;
		if (!ready && !shield && target.isPanel && platform === "darwin") {
			shield = new BrowserWindow({
				...panelBounds(target.display, true),
				title: "open-quake panel shield",
				show: false,
				frame: false,
				backgroundColor: "#000000",
				focusable: false,
				resizable: false,
				minimizable: false,
				maximizable: false,
				skipTaskbar: true,
				enableLargerThanScreen: true,
				webPreferences: {
					contextIsolation: true,
					nodeIntegration: false,
					sandbox: true,
				},
			});
			shield.setIgnoreMouseEvents(true);
			shield.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
			shield.setAlwaysOnTop(true, "screen-saver", 0);
			shield.showInactive();
		}
		if (!wasRequested || !ready) reveal();
	};
	const park = () => {
		requested = false;
		clearShield();
		for (const timer of timers) clearTimeout(timer);
		timers.clear();
		if (win.isDestroyed()) return;
		hiddenBounds = panelBounds(target.display, target.isPanel);
		win.hide();
		win.setOpacity(0);
		win.setBounds({ x: 0, y: 0, width: 1, height: 1 });
	};
	const dispose = () => {
		if (disposed) return;
		closedBounds = hiddenBounds ?? panelBounds(target.display, target.isPanel);
		park();
		disposed = true;
		clearInterval(guard);
	};
	const guard = setInterval(() => {
		if (requested && ready) top();
	}, 1000);
	if (platform !== "win32" || !target.isPanel) clearInterval(guard);
	win.on("closed", dispose);
	win.on("minimize", () =>
		later(10, () => {
			if (requested) {
				win.restore();
				reveal();
			}
		}),
	);
	win.webContents.on("did-start-loading", () => {
		ready = !target.isPanel;
	});
	win.webContents.on("did-finish-load", () => {
		ready = true;
		reveal();
	});
	win.on("ready-to-show", () => {
		ready = true;
		reveal();
	});
	place(initial);
	return {
		show,
		park,
		place,
		dispose,
		positions: () => ({ hiddenBounds, closedBounds }),
	};
}

export function createPanelWindow(
	target: PanelTarget,
	development: boolean,
	platform: string = process.platform,
): BrowserWindow {
	const win = new BrowserWindow({
		...panelBounds(target.display, target.isPanel),
		title: "open-quake panel",
		show: !target.isPanel && development,
		frame: false,
		roundedCorners: false,
		...(target.isPanel && platform === "darwin" ? { type: "panel" } : {}),
		...(target.isPanel && platform === "linux" ? { type: "dock" } : {}),
		transparent: target.isPanel,
		focusable: !target.isPanel,
		skipTaskbar: target.isPanel,
		hasShadow: !target.isPanel,
		minimizable: !target.isPanel,
		maximizable: false,
		resizable: false,
		enableLargerThanScreen: true,
		fullscreenable: false,
		autoHideMenuBar: true,
		webPreferences: {
			preload: fileURLToPath(new URL("../preload/index.mjs", import.meta.url)),
			sandbox: false,
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	win.webContents.setAudioMuted(true);
	win.on("page-title-updated", (event) => event.preventDefault());
	if (target.isPanel) {
		win.setIgnoreMouseEvents(true);
		if (platform === "darwin" || platform === "linux")
			win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
		win.setOpacity(0);
	}
	owners.set(win, manage(win, target, platform));
	return win;
}
export const placePanel = (win: BrowserWindow, target: PanelTarget): void =>
	owners.get(win)?.place(target);
export const showPanel = (win: BrowserWindow): void => owners.get(win)?.show();
export const parkPanel = (win: BrowserWindow): void => owners.get(win)?.park();
export const destroyPanel = (win: BrowserWindow): void => {
	owners.get(win)?.dispose();
	if (!win.isDestroyed()) win.destroy();
};
