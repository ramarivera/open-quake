import { resolve } from "node:path";
import { defineConfig } from "electron-vite";

export default defineConfig({
	main: {
		build: {
			outDir: "out/media-smoke",
			rollupOptions: {
				input: resolve("src/main/media/smoke.ts"),
				external: ["electron", "effect"],
			},
		},
	},
});
