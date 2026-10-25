import { resolve } from "node:path";
import { defineConfig } from "electron-vite";

export default defineConfig({
	main: {
		build: {
			outDir: "out/agent-e2e",
			rollupOptions: {
				input: resolve("src/main/test/runtime-desktop-e2e.ts"),
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
