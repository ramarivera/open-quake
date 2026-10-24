export function integrationRequestAllowed(
	caller: string,
	renderer: string,
	mainFrame: boolean,
	management: boolean,
	type: string,
): boolean {
	if (!mainFrame || (!management && type !== "ha.live")) return false;
	try {
		const url = new URL(caller);
		const expected = new URL(renderer);
		return (
			url.protocol === expected.protocol &&
			url.host === expected.host &&
			url.pathname === expected.pathname
		);
	} catch {
		return false;
	}
}
