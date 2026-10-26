export const pages = [
	"overview",
	"profiles",
	"keys",
	"screen",
	"controls",
	"connection",
	"agents",
	"emoji",
	"shortcuts",
	"home-assistant",
	"appearance",
	"settings",
	"meetings",
] as const;
export type ManagementPage = (typeof pages)[number];
export type Activation = {
	readonly page: ManagementPage;
	readonly agentTab?: "sessions" | "agents" | "ai" | "settings";
};
export function managementActivation(input: string): Activation | null {
	const value = input.toLowerCase();
	if (
		[
			"clawdashboard",
			"clawinstall",
			"openclaw-dashboard",
			"openclaw-install",
		].includes(value)
	)
		return { page: "agents", agentTab: "sessions" };
	if (["general", "settings-general", "1"].includes(value))
		return { page: "settings" };
	if (["device", "settings-device", "2"].includes(value))
		return { page: "controls" };
	if (value === "openclaw-ai") return { page: "agents", agentTab: "ai" };
	if (["agents", "openclaw-agents"].includes(value))
		return { page: "agents", agentTab: "agents" };
	if (["claw", "openclaw", "clawcontrolpanel"].includes(value))
		return { page: "agents", agentTab: "sessions" };
	if (["meeting", "meetingminutes"].includes(value))
		return { page: "meetings" };
	if (["ai", "aiplugin", "shortcut", "shortcuts", "aishortcut"].includes(value))
		return { page: "shortcuts" };
	const page = pages.find((page) => page === value);
	return page ? { page } : null;
}

export type NavSectionId =
	| "home"
	| "device"
	| "assistant"
	| "integrations"
	| "app";
export type NavEntry = { readonly id: ManagementPage; readonly label: string };
export type NavSection = {
	readonly id: NavSectionId;
	/** Visible group heading; the first section is the untitled home group. */
	readonly title: string | null;
	readonly items: ReadonlyArray<NavEntry>;
};

/**
 * Management information architecture (independent-management-design).
 * Grouped by what the user is doing: the device itself, the assistant
 * features it drives, outside services, then the app's own preferences.
 */
export const navSections: ReadonlyArray<NavSection> = [
	{ id: "home", title: null, items: [{ id: "overview", label: "Overview" }] },
	{
		id: "device",
		title: "Device",
		items: [
			{ id: "keys", label: "Keys" },
			{ id: "profiles", label: "Knob profiles" },
			{ id: "screen", label: "Screen" },
			{ id: "controls", label: "Controls" },
			{ id: "connection", label: "Connection" },
		],
	},
	{
		id: "assistant",
		title: "Assistant",
		items: [
			{ id: "agents", label: "Agents" },
			{ id: "shortcuts", label: "AI shortcuts" },
			{ id: "emoji", label: "AI emoji" },
			{ id: "meetings", label: "Meetings" },
		],
	},
	{
		id: "integrations",
		title: "Integrations",
		items: [{ id: "home-assistant", label: "Home Assistant" }],
	},
	{
		id: "app",
		title: "App",
		items: [
			{ id: "appearance", label: "Appearance" },
			{ id: "settings", label: "Settings" },
		],
	},
];

export type PageLayout = "default" | "wide" | "full";

/** Content measure per page: forms read best narrow, workspaces need room. */
export const pageLayouts: Readonly<Record<ManagementPage, PageLayout>> = {
	overview: "wide",
	keys: "wide",
	profiles: "wide",
	screen: "wide",
	controls: "default",
	connection: "default",
	agents: "full",
	shortcuts: "wide",
	emoji: "wide",
	meetings: "wide",
	"home-assistant": "wide",
	appearance: "default",
	settings: "default",
};

export function pageLocation(page: ManagementPage): {
	readonly section: string | null;
	readonly label: string;
} {
	for (const section of navSections) {
		const entry = section.items.find((item) => item.id === page);
		if (entry) return { section: section.title, label: entry.label };
	}
	return { section: null, label: page };
}
