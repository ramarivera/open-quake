import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
export default defineConfig({
	main: {
		build: {
			outDir: "out/acceptance-audio",
			rollupOptions: {
				input: resolve("src/main/hardware/acceptance/audio-smoke.ts"),
				external: ["electron"],
				output: { format: "es" },
			},
			externalizeDeps: { exclude: ["effect", "@open-quake/edge"] },
		},
	},
});
