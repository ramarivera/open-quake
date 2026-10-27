import { defineConfig } from "vitest/config";

/** Never discovered by the ordinary desktop/package test commands. */
export default defineConfig({
	test: {
		include: ["src/main/hardware/acceptance/native.e2e.ts"],
		environment: "node",
		maxWorkers: 1,
		fileParallelism: false,
	},
});
