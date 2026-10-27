import { resolve } from "node:path";
import { defineConfig } from "electron-vite";

export default defineConfig({
	main: {
		build: {
			outDir: "out/keyboard-smoke",
			externalizeDeps: {
				exclude: ["@open-quake/device", "@open-quake/protocol"],
			},
			rollupOptions: {
				input: resolve("src/main/hardware/acceptance/keyboard-smoke.ts"),
				external: ["electron", "node-hid", "koffi", "effect"],
			},
		},
	},
});
