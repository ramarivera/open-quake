import { realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const inside = (root: string, path: string) => {
	const part = relative(root, path);
	return (
		part === "" ||
		(!part.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
			part !== ".." &&
			!isAbsolute(part))
	);
};
function canonical(path: string): string {
	try {
		return realpathSync(path);
	} catch (cause) {
		if (
			!(
				typeof cause === "object" &&
				cause !== null &&
				"code" in cause &&
				cause.code === "ENOENT"
			)
		)
			throw cause;
		const parent = dirname(path);
		if (parent === path) throw cause;
		return join(canonical(parent), relative(parent, path));
	}
}

/** Validate before creating fixtures or changing Electron's userData path. */
export function smokeScratchPaths(input: {
	readonly scratch: string | undefined;
	readonly temporary: string | undefined;
	readonly artifacts: string;
	readonly userData: string;
	readonly home: string;
}): { scratch: string; temporary: string; artifacts: string } {
	const { scratch, temporary, artifacts } = input;
	if (
		!scratch ||
		!temporary ||
		![scratch, temporary, artifacts].every(isAbsolute)
	)
		throw new Error(
			"Explicit absolute OPEN_QUAKE_SMOKE_SCRATCH, TMPDIR and artifact paths required",
		);
	const root = realpathSync(scratch);
	const temp = realpathSync(temporary);
	const output = canonical(resolve(artifacts));
	const userData = canonical(resolve(input.userData));
	const home = realpathSync(input.home);
	if (
		!statSync(root).isDirectory() ||
		!statSync(temp).isDirectory() ||
		inside(root, home) ||
		inside(root, userData) ||
		inside(userData, root) ||
		!inside(root, temp) ||
		!inside(root, output) ||
		root === output
	)
		throw new Error(
			"Smoke paths must stay in owned scratch outside real userData and home roots",
		);
	return { scratch: root, temporary: temp, artifacts: output };
}
