export const profileRequestAllowed = (
	url: string,
	renderer: string,
	topLevel: boolean,
	management: boolean,
	type: string,
	managementURL = renderer,
): boolean => {
	try {
		const u = new URL(url),
			r = new URL(renderer);
		return (
			topLevel &&
			u.protocol === r.protocol &&
			u.host === r.host &&
			u.origin === r.origin &&
			u.pathname === r.pathname &&
			(type === "read" ||
				(management && u.href === new URL(managementURL).href))
		);
	} catch {
		return false;
	}
};
