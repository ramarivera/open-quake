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
