/** Only the app's exact renderer document may use the media bridge. */
export function canRequestWallpaper(
	caller: string,
	renderer: string,
	input: unknown,
): boolean {
	try {
		const url = new URL(caller);
		const expected = new URL(renderer);
		if (
			url.protocol !== expected.protocol ||
			url.host !== expected.host ||
			url.pathname !== expected.pathname
		)
			return false;
		return (
			url.searchParams.get("surface") !== "panel" ||
			(typeof input === "object" &&
				input !== null &&
				"_tag" in input &&
				input._tag === "read")
		);
	} catch {
		return false;
	}
}
