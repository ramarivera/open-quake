import { resolve } from "node:path";
import { defineConfig } from "electron-vite";

/** Opt-in only. Production renderer/preload and the unmodified composition root. */
export default defineConfig({
	main: {
		define: {
			__OPEN_QUAKE_MANAGEMENT_EXERCISER__: "true",
			"process.env.OPEN_QUAKE_MOCK_DEVICE": '"1"',
			"process.env.OPEN_QUAKE_E2E_RUN": '"1"',
		},
		resolve: {
			alias: { "node-hid": resolve("src/main/management/exerciser-no-hid.ts") },
		},
		build: {
			outDir: resolve(
				process.env.OPEN_QUAKE_EXERCISER_BUILD ?? "out",
				"management-exerciser",
			),
			emptyOutDir: true,
			rollupOptions: {
				input: resolve("src/main/management/exerciser.ts"),
				external: ["electron", "koffi"],
				output: { format: "es", chunkFileNames: "[name]-[hash].js" },
			},
			externalizeDeps: {
				include: ["koffi"],
				exclude: [
					"node-hid",
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
