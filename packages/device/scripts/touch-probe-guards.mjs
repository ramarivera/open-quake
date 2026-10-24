import { realpathSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
export const SCRATCH =
	"/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/strip-touch";
export const TOUCH_PROBE_IDENTITY = {
	vendorId: 0x0712,
	productId: 0x0010,
	usagePage: 0xff73,
	usage: 0x71,
};
export function isCompetingApp(command) {
	return (
		/DK[- ]?Suite(?:\.app|\b)/i.test(command) ||
		/(?:^|[\s/])open-quake(?:\.app|\s|$)/i.test(command) ||
		(/electron(?:-vite)?/i.test(command) &&
			/(?:open-quake|\boq-[\w-]+)/i.test(command))
	);
}
export function competingProcesses(ps, ownPid) {
	return ps.split("\n").flatMap((line) => {
		const match = line.trim().match(/^(\d+)\s+(.+)$/);
		return match && Number(match[1]) !== ownPid && isCompetingApp(match[2])
			? [Number(match[1])]
			: [];
	});
}
export function validateOutput(path) {
	const base = realpathSync(SCRATCH),
		parent = realpathSync(dirname(resolve(path)));
	const within = relative(base, parent);
	if (
		within === ".." ||
		within.startsWith(`..${sep}`) ||
		within.startsWith(sep)
	)
		throw new Error("Output must be inside strip-touch scratch");
	return resolve(parent, resolve(path).split(sep).at(-1));
}
export function isProbeCollection(info) {
	return (
		Object.entries(TOUCH_PROBE_IDENTITY).every(
			([key, value]) => info[key] === value,
		) &&
		typeof info.path === "string" &&
		info.path.length > 0
	);
}
