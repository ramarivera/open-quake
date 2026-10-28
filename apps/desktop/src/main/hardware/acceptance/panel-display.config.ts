import { resolve } from "node:path";
import { defineConfig } from "electron-vite";

// Built beside the production renderer/preload so the composition root's
// relative paths resolve exactly as in out/main.
export default defineConfig({
	main: {
		build: {
			outDir: "out/panel-display",
			emptyOutDir: true,
			rollupOptions: {
				input: resolve("src/main/hardware/acceptance/panel-display.ts"),
				external: ["electron", "node-hid", "koffi"],
				output: { format: "es", chunkFileNames: "[name]-[hash].js" },
			},
			externalizeDeps: {
				include: ["node-hid", "koffi"],
				exclude: [
					"effect",
					"@open-quake/device",
					"@open-quake/protocol",
					"@open-quake/edge",
					"@zip.js/zip.js",
				],
			},
		},
	},
});
