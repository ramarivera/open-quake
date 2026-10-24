import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
export default defineConfig({
	main: {
		build: {
			outDir: "out/maintenance-smoke",
			rollupOptions: {
				input: resolve("src/main/maintenance/smoke.ts"),
				external: ["electron", "effect", "koffi", "@zip.js/zip.js"],
			},
		},
	},
});
