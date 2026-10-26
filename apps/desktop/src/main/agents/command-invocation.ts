import { AgentInvalid } from "../../../../../packages/edge/src/agents/agents-errors";

/** Fixed argv stays direct except for Windows batch shims, which require cmd.exe. */
export function agentCommandInvocation(
	executable: string,
	args: readonly string[],
	platform: NodeJS.Platform = process.platform,
	commandProcessor = process.env.ComSpec || "cmd.exe",
): [
	string,
	string[],
	{ shell: false; windowsHide: true; windowsVerbatimArguments: boolean },
] {
	const options = {
		shell: false,
		windowsHide: true,
		windowsVerbatimArguments: false,
	} as const;
	if (platform !== "win32" || !/\.(cmd|bat)$/i.test(executable))
		return [executable, [...args], options];
	// Quotes delimit every argument. Reject syntax that can escape quotes or expand
	// environment values, even inside quotes. /v:off disables delayed expansion.
	if ([executable, ...args].some((value) => /["%!^&|<>\r\n\0]/.test(value)))
		throw new AgentInvalid();
	return [
		commandProcessor,
		[
			"/d",
			"/s",
			"/v:off",
			"/c",
			`"${[executable, ...args].map((value) => `"${value}"`).join(" ")}"`,
		],
		{ ...options, windowsVerbatimArguments: true },
	];
}
