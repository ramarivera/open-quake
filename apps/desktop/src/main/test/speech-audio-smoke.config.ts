import { resolve } from "node:path";
import { defineConfig } from "electron-vite";

export default defineConfig({
	main: {
		build: {
			outDir: "out/speech-smoke",
			rollupOptions: {
				input: resolve("src/main/test/speech-audio-smoke.ts"),
				external: ["electron"],
				output: { format: "es" },
			},
			externalizeDeps: { exclude: ["effect", "@open-quake/edge"] },
		},
	},
});
