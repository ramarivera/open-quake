import { resolve } from "node:path";
import { defineConfig } from "electron-vite";

export default defineConfig({
	main: {
		build: {
			outDir: "out/runtime-profile",
			rollupOptions: {
				input: resolve("src/main/test/runtime-profile-export.ts"),
				external: ["electron"],
				output: { format: "es" },
			},
			externalizeDeps: { exclude: ["effect", "@open-quake/edge"] },
		},
	},
});
