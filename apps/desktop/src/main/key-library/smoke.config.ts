import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
export default defineConfig({
	main: {
		build: {
			outDir: "out/keys-smoke",
			rollupOptions: {
				input: resolve("src/main/key-library/smoke.ts"),
				external: ["electron", "effect"],
			},
		},
	},
});
