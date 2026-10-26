import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
export default defineConfig({
	main: {
		build: {
			outDir: "out/clock-profile-smoke",
			rollupOptions: {
				input: resolve("src/main/clock/profile-smoke.ts"),
				external: ["electron", "effect"],
			},
		},
	},
});
