export const pages = [
	"overview",
	"profiles",
	"screen",
	"controls",
	"connection",
	"agents",
	"emoji",
	"shortcuts",
	"home-assistant",
	"appearance",
] as const;
export type ManagementPage = (typeof pages)[number];
export type Activation = {
	readonly page: ManagementPage;
	readonly agentTab?: "sessions" | "agents" | "ai" | "settings";
};
export function managementActivation(input: string): Activation | null {
	const value = input.toLowerCase();
	if (value === "openclaw-ai") return { page: "agents", agentTab: "ai" };
	if (["agents", "openclaw-agents"].includes(value))
		return { page: "agents", agentTab: "agents" };
	if (["claw", "openclaw", "clawcontrolpanel"].includes(value))
		return { page: "agents", agentTab: "sessions" };
	if (["ai", "aiplugin", "shortcut", "shortcuts", "aishortcut"].includes(value))
		return { page: "shortcuts" };
	const page = pages.find((page) => page === value);
	return page ? { page } : null;
}
