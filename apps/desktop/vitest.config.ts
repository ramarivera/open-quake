import { defineConfig } from "vitest/config";
import { mdiPlugin } from "./mdi-plugin";

export default defineConfig({
	// Resolve virtual:mdi-icons like the renderer build does.
	plugins: [mdiPlugin()],
	test: {
		environment: "node",
		include: ["src/**/*.test.{ts,tsx}"],
		clearMocks: true,
		restoreMocks: true,
	},
});
