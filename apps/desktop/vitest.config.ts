import { defineConfig } from "vitest/config";
import { mdiPlugin } from "./mdi-plugin";

export default defineConfig({
	plugins: [mdiPlugin()],
	test: {
		environment: "node",
		include: ["src/**/*.test.{ts,tsx}"],
		clearMocks: true,
		restoreMocks: true,
	},
});
