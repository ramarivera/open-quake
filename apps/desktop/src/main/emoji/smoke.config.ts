import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { mdiPlugin } from "../../../mdi-plugin";

export default defineConfig({
	main: {
		build: {
			outDir: "out/emoji-smoke/main",
			rollupOptions: {
				input: resolve("src/main/emoji/smoke.ts"),
				external: ["electron", "effect"],
			},
		},
	},
	renderer: {
		root: resolve("src/main/emoji"),
		plugins: [react(), mdiPlugin()],
		build: {
			outDir: resolve("out/emoji-smoke/renderer"),
			rollupOptions: { input: resolve("src/main/emoji/smoke.html") },
		},
	},
});
