import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
export default defineConfig({
	main: {
		build: {
			outDir: "out/profiles-smoke",
			rollupOptions: {
				input: resolve("src/main/profiles/smoke.ts"),
				external: ["electron", "effect"],
			},
		},
	},
});
