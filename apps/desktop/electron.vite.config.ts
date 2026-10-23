import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

export default defineConfig({
	main: {
		build: {
			// Workspace packages export TypeScript; Electron must run bundled JS.
			externalizeDeps: {
				// Native bindings must resolve relative to node-hid's own package.
				include: ["node-hid"],
				exclude: ["@open-quake/device", "@open-quake/protocol"],
			},
		},
	},
	preload: {},
	renderer: {
		plugins: [react()],
	},
});
