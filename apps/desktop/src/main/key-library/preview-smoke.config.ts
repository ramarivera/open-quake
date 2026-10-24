import { resolve } from "node:path";
import { defineConfig } from "electron-vite";

export default defineConfig({
	main: {
		build: {
			outDir: "out/preview-smoke",
			rollupOptions: {
				input: resolve("src/main/key-library/preview-smoke.ts"),
				external: ["electron", "effect"],
			},
		},
	},
});
