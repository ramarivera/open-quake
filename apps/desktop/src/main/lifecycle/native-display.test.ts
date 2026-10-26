import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { CORE_GRAPHICS_PROGRAM, callDisplayTool } from "./native-display";

describe.runIf(process.platform === "darwin")(
	"native CoreGraphics bindings",
	() => {
		it("loads every binding and probes mirroring without changing displays", async () => {
			// ID zero is not an active display. The fixed probe performs no mutation,
			// but binds the same functions used by consented arrangement repair.
			const result = await Effect.runPromise(callDisplayTool("probe", 0));
			expect(result).toBe("extended");
		}, 15_000);
		it("round-trips the configuration output pointer without changing displays", async () => {
			const execute = promisify(execFile);
			// Replace only the driver. Keep the production bindings and exercise
			// begin/cancel, so this test never commits a display configuration.
			const program = `${CORE_GRAPHICS_PROGRAM}
function run() {
  var config = Ref(), status = $.CGBeginDisplayConfiguration(config);
  if (status !== 0) throw Error('Cannot begin display configuration: ' + status);
  return $.CGCancelDisplayConfiguration(config[0]);
}`;
			const result = await execute(
				"/usr/bin/osascript",
				["-l", "JavaScript", "-e", program],
				{ timeout: 10_000 },
			);
			expect(result.stdout.trim()).toBe("0");
		}, 15_000);
	},
);

import { vi } from "vitest";
import {
	DisplayOperationFailed,
	extendWindowsDisplays,
	type NativeTool,
	probeWindowsDisplays,
} from "./native-display";

describe("Windows native adapter without host mutation", () => {
	it.each([
		[{ screens: [], names: ["DK-QUAKE"] }, "wmi-name", 0],
		[
			{ screens: [{ width: 1920, height: 480 }], names: [] },
			"forms-size",
			1920,
		],
		[
			{ screens: [{ width: 2560, height: 1440 }], names: ["Desktop"] },
			"none",
			0,
		],
	])(
		"MAIN-043 decodes the native evidence source",
		async (data, source, width) => {
			const run = vi.fn<NativeTool>(() => Effect.succeed(JSON.stringify(data)));
			const result = await Effect.runPromise(probeWindowsDisplays(run));
			expect(result).toMatchObject({ source, width, failed: false });
			expect(run.mock.calls[0]?.[0]).toBe("powershell.exe");
		},
	);
	it("MAIN-043 preserves malformed output and child-process error identity", async () => {
		const cause = new Error("token=secret");
		const error = new DisplayOperationFailed(cause);
		const failed = await Effect.runPromise(
			Effect.flip(probeWindowsDisplays(() => Effect.fail(error))),
		);
		expect(failed.code).toBe(error.code);
		expect(failed.originalCause).toBe(cause);
		const malformed = await Effect.runPromise(
			Effect.flip(probeWindowsDisplays(() => Effect.succeed("invalid"))),
		);
		expect(malformed.code).toBe(error.code);
		expect(malformed.originalCause).toBeDefined();
		expect(JSON.stringify(malformed)).not.toContain("secret");
	});
	it("MAIN-044 invokes a fixed executable and argument without shell interpolation", async () => {
		const run = vi.fn<NativeTool>(() => Effect.succeed(""));
		await Effect.runPromise(extendWindowsDisplays(run));
		expect(run).toHaveBeenCalledExactlyOnceWith("DisplaySwitch.exe", [
			"/extend",
		]);
	});
});
