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
