import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
export default defineConfig({
	main: {
		build: {
			outDir: "out/meetings-smoke",
			rollupOptions: {
				input: resolve("src/main/meetings/smoke.ts"),
				external: ["electron", "effect"],
			},
		},
	},
});
