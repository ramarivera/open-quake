import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { mdiPlugin, phosphorPlugin } from "./mdi-plugin";
import { buildNativeMedia } from "./native-media-build";

export default defineConfig({
	main: {
		plugins: [
			{
				name: "open-quake-native-media",
				buildStart: () => buildNativeMedia(import.meta.dirname),
			},
		],
		build: {
			rollupOptions: {
				input: { index: resolve("src/main/entry.ts") },
				external: ["electron", "node-hid", "koffi"],
				// Existing runtime resource paths are relative to out/main.
				output: { format: "es", chunkFileNames: "[name]-[hash].js" },
			},
			// Workspace packages export TypeScript; Electron must run bundled JS.
			externalizeDeps: {
				// Native bindings must resolve relative to node-hid's own package.
				include: ["node-hid", "koffi"],
				exclude: [
					"@open-quake/device",
					"@open-quake/protocol",
					"@open-quake/edge",
					"effect",
					"@zip.js/zip.js",
				],
			},
		},
	},
	preload: {},
	renderer: {
		plugins: [react(), mdiPlugin(), phosphorPlugin()],
	},
});
