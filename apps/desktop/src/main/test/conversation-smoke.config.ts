import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { mdiPlugin } from "../../../mdi-plugin";

export default defineConfig({
	main: {
		build: {
			outDir: "out/conversation-smoke",
			rollupOptions: {
				input: resolve("src/main/test/conversation-smoke.ts"),
				external: ["electron"],
			},
		},
	},
	renderer: {
		plugins: [react(), mdiPlugin()],
		define: { "process.env.NODE_ENV": JSON.stringify("development") },
		build: {
			outDir: "out/conversation-smoke-renderer",
			rollupOptions: { input: resolve("src/renderer/conversation-smoke.html") },
			minify: false,
		},
	},
});
