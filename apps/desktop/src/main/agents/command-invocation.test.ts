import { expect, it } from "vitest";
import { AgentInvalid } from "../../../../../packages/edge/src/agents/agents-errors";
import { agentCommandInvocation } from "./command-invocation";

const shim = "C:\\Program Files (x86)\\OpenClaw\\openclaw.cmd";
const processor = "C:\\Windows\\System32\\cmd.exe";
it.each(["cmd", "CMD", "bat"])(
	"preserves quoted Windows %s shim paths and fixed argv",
	(extension) => {
		const executable = shim.replace(/cmd$/, extension);
		const args = ["gateway", "run", "--port", "18789"];
		expect(
			agentCommandInvocation(executable, args, "win32", processor),
		).toEqual([
			processor,
			[
				"/d",
				"/s",
				"/v:off",
				"/c",
				`""${executable}" "gateway" "run" "--port" "18789""`,
			],
			{ shell: false, windowsHide: true, windowsVerbatimArguments: true },
		]);
		expect(args).toEqual(["gateway", "run", "--port", "18789"]);
	},
);
it("preserves channel pairing arguments without shell interpolation", () => {
	expect(
		agentCommandInvocation(
			shim,
			["pairing", "approve", "--channel", "discord", "ABC-123"],
			"win32",
			processor,
		)[1].at(-1),
	).toBe(`""${shim}" "pairing" "approve" "--channel" "discord" "ABC-123""`);
});
it.each(["win32", "darwin", "linux"] as const)(
	"keeps native binaries direct on %s",
	(platform) => {
		expect(
			agentCommandInvocation(
				"/private/openclaw",
				["health", "--json"],
				platform,
				processor,
			),
		).toEqual([
			"/private/openclaw",
			["health", "--json"],
			{ shell: false, windowsHide: true, windowsVerbatimArguments: false },
		]);
	},
);
it.each([
	'bad" & whoami',
	"%COMSPEC%",
	"!COMSPEC!",
	"x&whoami",
	"x|whoami",
	"x^y",
	"x>out",
	"bad\r\nwhoami",
	"bad\u0000path",
])("rejects command expansion or quote syntax %j", (unsafe) => {
	expect(() =>
		agentCommandInvocation(shim, [unsafe], "win32", processor),
	).toThrow(AgentInvalid);
	expect(() =>
		agentCommandInvocation(`C:\\${unsafe}.cmd`, [], "win32", processor),
	).toThrow(AgentInvalid);
});
