import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
	options: { capture: { type: "boolean" }, "self-test": { type: "boolean" } },
});
if (Boolean(values.capture) === Boolean(values["self-test"]))
	throw new Error("Choose exactly one of --capture or --self-test");
const root = "/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-hardware-e2e";
if (!existsSync("/Volumes/ExtSSD"))
	throw new Error("Scratch volume is unavailable");
mkdirSync(root, { recursive: true });
const run = mkdtempSync(join(root, "guided-run-"));
const build = join(run, "build");
symlinkSync(
	join(process.cwd(), "node_modules"),
	join(run, "node_modules"),
	"dir",
);
const env = {
	...process.env,
	TMPDIR: run,
	OPEN_QUAKE_EXERCISER_BUILD: build,
	OPEN_QUAKE_GUIDED_BUILD: build,
	OPEN_QUAKE_GUIDED_CAPTURE: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
if (values["self-test"]) {
	env.OPEN_QUAKE_GUIDED_CAPTURE_SELF_TEST = "1";
	env.OPEN_QUAKE_MOCK_DEVICE = "1";
} else {
	delete env.OPEN_QUAKE_GUIDED_CAPTURE_SELF_TEST;
	delete env.OPEN_QUAKE_MOCK_DEVICE;
	delete env.OPEN_QUAKE_FAKE_HID_DEVICES;
}
const execute = (args) => {
	const child = spawnSync("pnpm", args, { env, stdio: "inherit" });
	if (child.error) throw child.error;
	if (child.status !== 0) process.exit(child.status ?? 1);
};
console.log(`Guided capture artifacts: ${run}`);
execute(["exec", "electron-vite", "build", "--outDir", build]);
execute([
	"exec",
	"electron-vite",
	"build",
	"--config",
	"src/main/hardware/acceptance/guided-input.config.ts",
]);
execute(["exec", "electron", join(build, "guided-input/guided-input.js"), run]);
