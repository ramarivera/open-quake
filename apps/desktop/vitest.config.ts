import { defineConfig } from "vitest/config";
import { mdiPlugin } from "./mdi-plugin";

export default defineConfig({
	plugins: [mdiPlugin()],
	test: {
		environment: "node",
		include: ["src/**/*.test.{ts,tsx}"],
		env: { OPEN_QUAKE_MOCK_DEVICE: "1" },
		clearMocks: true,
		restoreMocks: true,
	},
});
