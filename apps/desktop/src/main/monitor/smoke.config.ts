import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
export default defineConfig({
	main: {
		build: {
			outDir: "out/monitor-smoke",
			rollupOptions: {
				input: resolve("src/main/monitor/smoke.ts"),
				external: ["electron", "effect"],
			},
		},
	},
});
