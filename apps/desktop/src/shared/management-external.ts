/** Project links shipped in packages/device/src/profiles/builtins/default_*_shortcut_config.json.
 * Exact matches forbid credentials, arbitrary paths, queries and fragments. No mailto is shipped.
 */
export const managementExternalLinks = [
	"https://github.com/ramarivera/open-quake",
	"https://github.com/ramarivera/open-quake/issues",
] as const;
export const isManagementExternalLink = (value: unknown): value is string =>
	typeof value === "string" &&
	managementExternalLinks.some((url) => url === value);
