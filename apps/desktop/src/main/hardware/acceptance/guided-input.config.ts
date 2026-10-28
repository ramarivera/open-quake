import { resolve } from "node:path";
import { defineConfig } from "electron-vite";

const selfTest = process.env.OPEN_QUAKE_GUIDED_CAPTURE_SELF_TEST === "1";
/** Additional opt-in entry; reuse the normal production renderer and preload. */
export default defineConfig({
	main: {
		resolve: {
			alias: selfTest
				? { "node-hid": resolve("src/main/management/exerciser-no-hid.ts") }
				: {},
		},
		define: { __OPEN_QUAKE_MANAGEMENT_EXERCISER__: "false" },
		build: {
			outDir: resolve(
				process.env.OPEN_QUAKE_GUIDED_BUILD ?? "out",
				"guided-input",
			),
			rollupOptions: {
				input: resolve("src/main/hardware/acceptance/guided-input.ts"),
				external: ["electron", "koffi", ...(selfTest ? [] : ["node-hid"])],
				output: { format: "es", chunkFileNames: "[name]-[hash].js" },
			},
			externalizeDeps: {
				include: ["koffi", ...(selfTest ? [] : ["node-hid"])],
				exclude: [
					...(selfTest ? ["node-hid"] : []),
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
