/** Cancel native work, bound resource cleanup, then release ownership before exit. */
export function acceptanceDeadline(
	release: () => Promise<void>,
	exit: () => void,
	durationMs = 20_000,
	cleanupMs = 1_500,
) {
	const controller = new AbortController();
	const resources = new Set<() => Promise<void>>();
	let expired = false;
	const timer = setTimeout(async () => {
		expired = true;
		controller.abort();
		let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				Promise.allSettled(
					[...resources].map((close) => Promise.resolve().then(close)),
				),
				new Promise<void>((resolve) => {
					cleanupTimer = setTimeout(resolve, cleanupMs);
				}),
			]);
		} finally {
			clearTimeout(cleanupTimer);
			let releaseTimer: ReturnType<typeof setTimeout> | undefined;
			try {
				await Promise.race([
					Promise.resolve()
						.then(release)
						.catch(() => undefined),
					new Promise<void>((resolve) => {
						releaseTimer = setTimeout(resolve, cleanupMs);
					}),
				]);
			} finally {
				clearTimeout(releaseTimer);
				exit();
			}
		}
	}, durationMs);
	return {
		signal: controller.signal,
		add(close: () => Promise<void>) {
			resources.add(close);
			return () => resources.delete(close);
		},
		finish() {
			if (!expired) clearTimeout(timer);
		},
	};
}
