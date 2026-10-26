import assert from "node:assert/strict";
import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { parseArgs } from "node:util";
import { Effect, Redacted } from "effect";
import { app } from "electron";
import { createAgentStorage } from "../agents/storage";
import { createModelCredentials } from "../chat/credentials";
import { systemCredentialVault } from "../integrations/storage";
import { readRuntimeProfile } from "./runtime-profile";

const fail = () => {
	process.stderr.write("PRODUCTION_PROFILE_READ_FAILED\n");
	app.exit(1);
};
process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);
const deadline = setTimeout(fail, 20000);
// No app root, windows, HID, inference or writes to the selected source data.
assert.equal(process.env.OPEN_QUAKE_E2E_RUN, "1");
const { values } = parseArgs({
	args: process.argv.slice(2),
	options: {
		"user-data": { type: "string" },
		"model-row": { type: "string" },
		scope: { type: "string" },
		"authorize-model": { type: "string" },
		output: { type: "string" },
	},
});
const source = values["user-data"];
const output = values.output;
assert(source && isAbsolute(source) && output && isAbsolute(output));
const io = { source, output };
assert(values["model-row"] && values.scope && values["authorize-model"]);
const selection = {
	scope: values.scope,
	rowId: values["model-row"],
	authorizedModel: values["authorize-model"],
};
assert.equal(await realpath(source), source);
assert.equal(await realpath(output), output);
// Refuse missing state before createAgentStorage's normal initialization path.
assert((await lstat(join(source, "agents-v1", "current"))).isFile());
const session = join(output, "reader-session");
await mkdir(session, { mode: 0o700 });
app.setPath("userData", session);
app.setPath("sessionData", session);
if (process.platform === "darwin") app.setActivationPolicy("prohibited");

async function run() {
	try {
		await app.whenReady();
		const credentials = await Effect.runPromise(
			createModelCredentials(
				systemCredentialVault(join(io.source, "agent-credentials")),
			),
		);
		const selected = await Effect.runPromise(
			readRuntimeProfile(
				selection,
				createAgentStorage(join(io.source, "agents-v1")),
				credentials.ai,
			),
		);
		await writeFile(
			join(io.output, "provider.json"),
			JSON.stringify({
				baseURL: selected.profile.baseUrl,
				model: selected.profile.modelId,
				apiKey: Redacted.value(selected.apiKey),
			}),
			{ flag: "wx", mode: 0o600 },
		);
		process.stdout.write("PRODUCTION_PROFILE_READ_OK\n");
		clearTimeout(deadline);
		app.exit(0);
	} catch {
		fail();
	}
}
void run();
