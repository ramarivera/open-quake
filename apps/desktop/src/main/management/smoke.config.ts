import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
export default defineConfig({
	main: {
		build: {
			outDir: "out/management-smoke",
			rollupOptions: {
				input: resolve("src/main/management/smoke.ts"),
				external: ["electron", "effect"],
			},
		},
	},
});
