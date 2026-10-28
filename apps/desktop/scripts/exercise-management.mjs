import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	statSync,
	symlinkSync,
} from "node:fs";
import { join } from "node:path";

const root = "/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-ui-exerciser";
if (
	!existsSync("/Volumes/ExtSSD") ||
	!statSync("/Volumes/ExtSSD").isDirectory()
)
	throw new Error("Scratch volume /Volumes/ExtSSD is unavailable");
mkdirSync(root, { recursive: true });
const run = mkdtempSync(join(root, "run-"));
const build = join(run, "build");
symlinkSync(
	join(process.cwd(), "node_modules"),
	join(run, "node_modules"),
	"dir",
);
const env = { ...process.env, TMPDIR: run, OPEN_QUAKE_EXERCISER_BUILD: build };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const execute = (args) => {
	const child = spawnSync("pnpm", args, { env, stdio: "inherit" });
	if (child.error) throw child.error;
	if (child.status !== 0) process.exit(child.status ?? 1);
};
console.log(`Management exerciser artifacts: ${run}`);
execute(["exec", "electron-vite", "build", "--outDir", build]);
execute([
	"exec",
	"electron-vite",
	"build",
	"--config",
	"src/main/management/exerciser.config.ts",
]);
execute([
	"exec",
	"electron",
	join(build, "management-exerciser/exerciser.js"),
	run,
]);
