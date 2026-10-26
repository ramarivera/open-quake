import { resolve } from "node:path";
import { defineConfig } from "electron-vite";

export default defineConfig({
	main: {
		build: {
			outDir: "out/lifecycle-smoke",
			rollupOptions: {
				input: resolve("src/main/lifecycle/smoke.ts"),
				external: ["electron", "effect"],
			},
		},
	},
});
