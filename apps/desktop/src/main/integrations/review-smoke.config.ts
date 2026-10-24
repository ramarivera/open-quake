import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
export default defineConfig({
	main: {
		build: {
			outDir: "out/management-review-main",
			rollupOptions: {
				input: resolve("src/main/integrations/review-smoke.ts"),
				external: ["electron", "effect"],
			},
		},
	},
	preload: {
		build: {
			outDir: "out/management-review-preload",
			rollupOptions: {
				input: resolve("src/main/integrations/review-preload.ts"),
				external: ["electron"],
				output: { format: "es", entryFileNames: "index.mjs" },
			},
		},
	},
	renderer: {
		root: "src/main/integrations/review-renderer",
		plugins: [react()],
		build: {
			outDir: resolve("out/management-review-renderer"),
			rollupOptions: {
				input: resolve("src/main/integrations/review-renderer/index.html"),
			},
		},
	},
});
