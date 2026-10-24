import { resolve } from "node:path";
import { defineConfig } from "electron-vite";

export default defineConfig({
	main: {
		build: {
			outDir: "out/knob-smoke",
			rollupOptions: {
				input: resolve("src/main/knob/smoke.ts"),
				external: ["electron", "effect"],
			},
		},
	},
});
