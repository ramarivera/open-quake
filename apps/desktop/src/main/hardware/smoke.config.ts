import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
export default defineConfig({
	main: {
		build: {
			outDir: "out/hardware-smoke",
			externalizeDeps: {
				exclude: ["@open-quake/device", "@open-quake/protocol"],
			},
			rollupOptions: {
				input: resolve("src/main/hardware/smoke.ts"),
				external: ["electron", "effect", "koffi", "node-hid"],
			},
		},
	},
});
