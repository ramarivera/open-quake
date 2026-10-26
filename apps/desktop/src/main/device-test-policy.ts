/** Entry-time policy, before native adapters or the application root are loaded. */
export function validateDeviceTestPolicy(
	packaged: boolean,
	env: NodeJS.ProcessEnv,
): void {
	if (packaged && env.OPEN_QUAKE_FAKE_HID_DEVICES !== undefined)
		throw new Error(
			"Custom fake HID fixtures are unavailable in packaged applications",
		);
	if (env.OPEN_QUAKE_FW_LIMITS !== undefined)
		throw new Error(
			"Firmware safety limits cannot be overridden by the test environment",
		);
}
export function startTestParentGuard(options: {
	readonly enabled: boolean;
	readonly parent: () => number;
	readonly quit: () => void;
	readonly schedule: (check: () => void, interval: number) => () => void;
}): () => void {
	if (!options.enabled) return () => {};
	const parent = options.parent();
	return options.schedule(() => {
		if (options.parent() !== parent || options.parent() <= 1) options.quit();
	}, 1000);
}
