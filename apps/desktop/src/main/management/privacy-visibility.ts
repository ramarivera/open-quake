/** Keep Settings reachable while macOS hands a user-initiated request to System Settings. */
export function createPrivacyVisibility(options: {
	readonly show: () => void;
	readonly platform?: string;
}) {
	let disposed = false;
	let requests = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const cancelTimer = () => {
		if (timer !== undefined) clearTimeout(timer);
		timer = undefined;
	};
	return {
		active: () => !disposed && (requests > 0 || timer !== undefined),
		begin: () => {
			if (disposed || (options.platform ?? process.platform) !== "darwin")
				return () => {};
			cancelTimer();
			requests++;
			options.show();
			let released = false;
			return () => {
				if (released || disposed) return;
				released = true;
				requests--;
				if (requests > 0) return;
				// Vendor keeps its settings window pinned through the 1600ms handoff.
				timer = setTimeout(() => {
					timer = undefined;
				}, 1600);
				timer.unref?.();
			};
		},
		dispose: () => {
			disposed = true;
			requests = 0;
			cancelTimer();
		},
	};
}
