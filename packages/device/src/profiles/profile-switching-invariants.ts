import { Option } from "effect";
import type { AppProfileLink } from "./profile-manager-contracts.js";

export const normalizeAppPath = (path: string): string => {
	const normalized = path.toLowerCase().replaceAll("\\", "/");
	const bundle = normalized.indexOf(".app/");
	return bundle < 0 ? normalized : normalized.slice(0, bundle + 4);
};
export const appPathSimilarity = (left: string, right: string): number => {
	const a = normalizeAppPath(left),
		b = normalizeAppPath(right);
	if (a === b) return 1;
	let previous = Array.from({ length: b.length + 1 }, () => 0);
	for (let i = 1; i <= a.length; i++) {
		const row = Array.from({ length: b.length + 1 }, () => 0);
		for (let j = 1; j <= b.length; j++)
			row[j] =
				a[i - 1] === b[j - 1]
					? (previous[j - 1] ?? 0) + 1
					: Math.max(previous[j] ?? 0, row[j - 1] ?? 0);
		previous = row;
	}
	return (previous[b.length] ?? 0) / Math.max(a.length, b.length);
};
export const matchAppProfiles = (
	path: string,
	links: readonly AppProfileLink[],
): readonly AppProfileLink[] => {
	let bestPath = "",
		score = 0;
	for (const link of links) {
		const candidate = appPathSimilarity(path, link.appPath);
		if (candidate >= 0.79 && candidate > score) {
			score = candidate;
			bestPath = link.appPath;
		}
	}
	return links.filter((link) => link.appPath === bestPath);
};
export interface ForegroundApp {
	readonly id: string;
	readonly path: string;
}
export const foregroundChanged = (
	previous: Option.Option<ForegroundApp>,
	next: Option.Option<ForegroundApp>,
): boolean =>
	Option.match(previous, {
		onNone: () => Option.isSome(next),
		onSome: (p) =>
			Option.match(next, {
				onNone: () => true,
				onSome: (n) => p.id !== n.id || p.path !== n.path,
			}),
	});
