import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Plugin } from "vite";

const require = createRequire(import.meta.url);
/** One lazy asset chunk instead of 7,447 individual SVG module requests. */
export function mdiPlugin(): Plugin {
	return {
		name: "mdi-icon-assets",
		generateBundle() {
			const root = dirname(require.resolve("@mdi/svg/package.json"));
			this.emitFile({
				type: "asset",
				fileName: "MDI-LICENSE.txt",
				source: readFileSync(join(root, "LICENSE"), "utf8"),
			});
		},
		resolveId: (id) =>
			id === "virtual:mdi-icons" ? "\0virtual:mdi-icons" : undefined,
		load(id) {
			if (id !== "\0virtual:mdi-icons") return;
			const root = dirname(require.resolve("@mdi/svg/package.json"));
			const metadata: readonly {
				name: string;
				tags: readonly string[];
				aliases: readonly string[];
			}[] = JSON.parse(readFileSync(join(root, "meta.json"), "utf8"));
			const icons = metadata.map((icon) => ({
				name: icon.name,
				tags: [...icon.tags, ...icon.aliases],
				path:
					/\bd="([^"]+)"/.exec(
						readFileSync(join(root, "svg", `${icon.name}.svg`), "utf8"),
					)?.[1] ?? "",
			}));
			return `export default ${JSON.stringify(icons)}`;
		},
	};
}

/** Keep the regular Phosphor catalog in one lazy chunk, like the MDI catalog. */
export function phosphorPlugin(): Plugin {
	return {
		name: "phosphor-icon-assets",
		generateBundle() {
			const root = dirname(dirname(require.resolve("@phosphor-icons/core")));
			this.emitFile({
				type: "asset",
				fileName: "PHOSPHOR-LICENSE.txt",
				source: readFileSync(join(root, "LICENSE"), "utf8"),
			});
		},
		resolveId: (id) =>
			id === "virtual:phosphor-icons" ? "\0virtual:phosphor-icons" : undefined,
		load(id) {
			if (id !== "\0virtual:phosphor-icons") return;
			const root = dirname(dirname(require.resolve("@phosphor-icons/core")));
			const catalog: {
				icons: readonly { name: string; tags: readonly string[] }[];
			} = require("@phosphor-icons/core");
			const icons = catalog.icons.map((icon) => ({
				name: icon.name,
				tags: icon.tags,
				svg: readFileSync(
					join(root, "assets", "regular", `${icon.name}.svg`),
					"utf8",
				).replace('fill="currentColor"', 'fill="white"'),
			}));
			return `export default ${JSON.stringify(icons)}`;
		},
	};
}
