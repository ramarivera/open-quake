import type {
	StartupPlan,
	WindowRectangle,
} from "../../../../../packages/edge/src/settings/general-contracts";

interface SettingsWindow {
	readonly isDestroyed: () => boolean;
	readonly isMaximized: () => boolean;
	readonly isFullScreen: () => boolean;
	readonly getBounds: () => WindowRectangle;
	readonly setBounds: (bounds: WindowRectangle) => void;
	readonly show: () => void;
	on(event: "move", callback: () => void): unknown;
	on(event: "resize", callback: () => void): unknown;
	on(event: "closed", callback: () => void): unknown;
	removeListener(event: "move", callback: () => void): unknown;
	removeListener(event: "resize", callback: () => void): unknown;
	removeListener(event: "closed", callback: () => void): unknown;
}

/** Own window persistence without opening a second settings store or writing login state. */
export function bindSettingsWindow(options: {
	readonly startup: () => Promise<StartupPlan>;
	readonly save: (bounds: WindowRectangle) => Promise<unknown>;
	readonly failure: (cause: unknown) => void;
}) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let latest: WindowRectangle | undefined;
	let work = Promise.resolve();
	let disposed = false;
	const listeners = new Map<SettingsWindow, () => void>();
	const flush = (): void => {
		if (timer) clearTimeout(timer);
		timer = undefined;
		if (!latest) return;
		const bounds = latest;
		latest = undefined;
		work = work
			.then(() => options.save(bounds))
			.then(() => {}, options.failure);
	};
	const attach = (win: SettingsWindow): void => {
		if (disposed || listeners.has(win)) return;
		const changed = (): void => {
			if (
				disposed ||
				win.isDestroyed() ||
				win.isMaximized() ||
				win.isFullScreen()
			)
				return;
			latest = win.getBounds();
			if (timer) clearTimeout(timer);
			timer = setTimeout(flush, 250);
		};
		const detach = (): void => {
			win.removeListener("move", changed);
			win.removeListener("resize", changed);
			win.removeListener("closed", detach);
			listeners.delete(win);
		};
		listeners.set(win, detach);
		win.on("move", changed);
		win.on("resize", changed);
		win.on("closed", detach);
	};
	return {
		attach,
		initialize: async (win: SettingsWindow): Promise<void> => {
			try {
				const plan = await options.startup();
				if (disposed || win.isDestroyed()) return;
				if (plan.window) win.setBounds(plan.window);
				if (!plan.hidden) win.show();
			} catch (cause) {
				options.failure(cause);
				if (!disposed && !win.isDestroyed()) win.show();
			} finally {
				if (!win.isDestroyed()) attach(win);
			}
		},
		dispose: async (): Promise<void> => {
			disposed = true;
			for (const detach of listeners.values()) detach();
			listeners.clear();
			flush();
			await work;
		},
	};
}
