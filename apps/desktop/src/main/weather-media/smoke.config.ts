import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
export default defineConfig({
	main: {
		build: {
			outDir: "out/weather-media-smoke",
			rollupOptions: {
				input: resolve("src/main/weather-media/smoke.ts"),
				external: ["electron", "effect"],
			},
		},
	},
});
