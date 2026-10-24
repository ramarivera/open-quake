import { expect, it, vi } from "vitest";
import { reportSmokeFailure } from "./smoke-failure";

it("retains a failed exit and original cause when native diagnostics throw", async () => {
	const previous = process.exitCode;
	const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
	try {
		process.exitCode = undefined;
		await reportSmokeFailure(new Error("original smoke failure"), async () => {
			expect(process.exitCode).toBe(1);
			throw new Error("capture failed");
		});
		expect(process.exitCode).toBe(1);
		expect(stderr).toHaveBeenCalledWith("Error: original smoke failure\n");
		expect(stderr).toHaveBeenCalledWith(
			"Smoke diagnostics failed: Error: capture failed\n",
		);
	} finally {
		process.exitCode = previous;
		stderr.mockRestore();
	}
});
