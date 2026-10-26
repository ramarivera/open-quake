import { Schema } from "effect";
import { providerSamplingValid } from "../ai/ai-sampling.js";
import { canonicalProvider } from "../ai/provider-catalog.js";
import { type Agent, AgentState, type ModelRow } from "./agents-contracts.js";
export const sanitizeAgentId = (value: string): string =>
	value
		.replace(/[^a-zA-Z0-9-]/g, "")
		.toLowerCase()
		.slice(0, 48);
export const skillFolderName = (
	name: string,
	occupied: readonly string[],
): string => {
	const slug = sanitizeAgentId(name.trim().replace(/\s+/g, "-"));
	const base = (/^[a-z]/.test(slug) ? slug : `skill-${slug || "new"}`).slice(
		0,
		48,
	);
	const used = new Set(occupied);
	if (!used.has(base)) return base;
	for (let index = 2; ; index++) {
		const suffix = `-${index}`;
		const candidate = base.slice(0, 48 - suffix.length) + suffix;
		if (!used.has(candidate)) return candidate;
	}
};
export const agentIdError = (
	id: string,
	agents: readonly Agent[],
): "format" | "reserved" | "duplicate" | "" =>
	id === "main" || id === "default"
		? "reserved"
		: !/^[a-z][a-z0-9-]*$/.test(id) || id.length > 48
			? "format"
			: agents.some((a) => a.id === id)
				? "duplicate"
				: "";
export const workspaceTemplates = (
	name: string,
	emoji: string,
): Readonly<Record<string, string>> => ({
	"IDENTITY.md": `# Identity\n\nName: ${name}\nEmoji: ${emoji}\n`,
	"SOUL.md": `# Purpose\n\nHelp the user thoughtfully. Ask when the goal is unclear.\n`,
	"AGENTS.md": `# Workspace guidance\n\nKeep private information private. Describe proposed actions and respect the user's choices.\n`,
});
export const initialAgentState = (): AgentState =>
	Schema.decodeUnknownSync(AgentState)({
		schemaVersion: 1,
		revision: 0,
		agents: [
			{
				id: "main",
				name: "Main",
				emoji: "🤖",
				files: workspaceTemplates("Main", "🤖"),
			},
		],
		skills: [],
		models: {
			default: [
				{
					id: "initial",
					role: "default",
					provider: "openai",
					model: "",
					baseUrl: "https://api.openai.com/v1",
					maxTokens: 4096,
					credentialRef: "",
				},
			],
		},
		slots: { "1,5": "main", "1,6": "main", "2,5": "main", "2,6": "main" },
	});
export const configured = (
	row: Pick<ModelRow, "provider" | "model">,
): boolean => row.provider.trim().length > 0 && row.model.trim().length > 0;
export function normalizeRoles(
	rows: readonly ModelRow[],
	changedId: string,
): readonly ModelRow[] {
	const changed = rows.find((r) => r.id === changedId);
	const selected =
		changed?.role === "default"
			? changed
			: (rows.find((r) => r.role === "default" && configured(r)) ??
				rows.find((r) => r.id !== changedId && configured(r)) ??
				rows.find(configured) ??
				rows[0]);
	return rows.map((r) => ({
		...r,
		role:
			r.id === selected?.id
				? "default"
				: r.role === "default"
					? "none"
					: r.role,
	}));
}
export const resolveModels = (
	state: AgentState,
	id: string,
): readonly ModelRow[] => {
	const rows =
		ownModelRows(state.models, id) ??
		ownModelRows(state.models, "default") ??
		[];
	return resolveModelRows(rows);
};
/** The model roles available to direct chat, also used by credential-free editors. */
export const resolveModelRows = <
	A extends Pick<ModelRow, "provider" | "model" | "role">,
>(
	rows: readonly A[],
): readonly A[] => [
	...rows.filter((r) => r.role === "default" && configured(r)),
	...rows.filter((r) => r.role === "fallback" && configured(r)),
];

export const modelValid = (row: ModelRow): boolean => {
	if (
		/[{}]|%7[bd]/i.test(row.baseUrl) ||
		!configured(row) ||
		!Number.isSafeInteger(row.maxTokens) ||
		row.maxTokens < 1 ||
		!providerSamplingValid(row) ||
		(row.temperature !== undefined &&
			(!Number.isFinite(row.temperature) ||
				row.temperature < 0 ||
				row.temperature > 2)) ||
		(row.topP !== undefined &&
			(!Number.isFinite(row.topP) || row.topP < 0 || row.topP > 1))
	)
		return false;
	try {
		const u = new URL(row.baseUrl);
		return (
			(u.protocol === "https:" || u.protocol === "http:") &&
			!u.username &&
			!u.password
		);
	} catch {
		return false;
	}
};
export function skillFrontMatter(
	content: string,
): { name: string; description: string } | undefined {
	const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
	if (!match?.[1]) return;
	const values = new Map(
		match[1].split(/\r?\n/).map((line) => {
			const i = line.indexOf(":");
			return [
				line.slice(0, i).trim(),
				line
					.slice(i + 1)
					.trim()
					.replace(/^['"]|['"]$/g, ""),
			];
		}),
	);
	const name = values.get("name"),
		description = values.get("description");
	return name && description !== undefined ? { name, description } : undefined;
}

/** A missing scope inherits defaults; Object.prototype is never an override. */
export const ownModelRows = <Row>(
	models: Readonly<Record<string, readonly Row[]>>,
	scope: string,
): readonly Row[] | undefined =>
	Object.hasOwn(models, scope) ? models[scope] : undefined;

/** Legacy provider siblings share endpoints; named configurations own theirs. */
export function sharesModelEndpoint(
	left: Pick<ModelRow, "provider" | "settings" | "name">,
	right: Pick<ModelRow, "provider" | "settings" | "name">,
): boolean {
	const provider = canonicalProvider(left.provider);
	return (
		left.name === undefined &&
		right.name === undefined &&
		provider === canonicalProvider(right.provider) &&
		(provider !== "qwen" ||
			Boolean(left.settings?.mediaKind) === Boolean(right.settings?.mediaKind))
	);
}
