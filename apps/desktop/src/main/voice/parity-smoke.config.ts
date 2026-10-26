import { resolve } from "node:path";
import { defineConfig } from "electron-vite";

export default defineConfig({
	main: {
		build: {
			outDir: "out/voice-parity-smoke",
			rollupOptions: {
				input: resolve("src/main/voice/parity-smoke.ts"),
				external: ["electron", "effect"],
			},
		},
	},
});
