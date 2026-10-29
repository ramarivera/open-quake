import {
	type BrowserWindow,
	dialog,
	type MessageBoxOptions,
	type OpenDialogOptions,
	type OpenDialogReturnValue,
	type SaveDialogOptions,
	type SaveDialogReturnValue,
} from "electron";

/** Maintenance must never fall back to a blocking, unowned native alert. */
export function maintenanceDialogs(
	management: () => BrowserWindow | undefined,
) {
	const owner = () => {
		const window = management();
		if (!window || window.isDestroyed()) return undefined;
		if (window.isMinimized()) window.restore();
		if (!window.isVisible()) window.show();
		window.focus();
		return window;
	};
	return {
		message: async (options: MessageBoxOptions) => {
			const window = owner();
			return window
				? dialog.showMessageBox(window, {
						...options,
						signal: options.signal
							? AbortSignal.any([options.signal, AbortSignal.timeout(60_000)])
							: AbortSignal.timeout(60_000),
					})
				: { response: options.cancelId ?? 0, checkboxChecked: false };
		},
		open: async (
			options: OpenDialogOptions,
		): Promise<OpenDialogReturnValue> => {
			const window = owner();
			return window
				? dialog.showOpenDialog(window, options)
				: { canceled: true, filePaths: [] };
		},
		save: async (
			options: SaveDialogOptions,
		): Promise<SaveDialogReturnValue> => {
			const window = owner();
			return window
				? dialog.showSaveDialog(window, options)
				: { canceled: true, filePath: "" };
		},
	};
}
