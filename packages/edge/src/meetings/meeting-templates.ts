import type { TemplateId } from "./meeting-contracts.js";

export const summaryTemplates = [
	{
		id: "project-weekly",
		name: "Project weekly",
		description: "Outcomes, decisions, actions, and risks",
		sections:
			"### Project Progress (last week / current blockers)\n### Key Decisions (decision + rationale + owner)\n### Action Items (task | owner | deadline | related decision)\n### Risks & Dependencies (risk + impact + mitigation)\nEvery action item must include an owner and a deadline.",
	},
	{
		id: "standard",
		name: "Standard minutes",
		description: "Topics, discussion points, and next steps",
		sections:
			"### Meeting Info (time / participants)\n### Topic Discussion (per topic: background → discussion points → conclusion)\n### Next Actions (task | owner | deadline)\n### Open Items\nRecord each topic with key discussion details.",
	},
	{
		id: "executive",
		name: "Executive decision brief",
		description: "Outcome-first with decisions and owners",
		sections:
			"### Decision Summary (conclusion-first, one line per decision)\n### Decision Details (decision + owner + impact + timeline)\n### Management Attention (risks / resources / escalations)\n### Action Items (task | owner | deadline)\nCompress process details; prioritize conclusions and owners.",
	},
	{
		id: "interview",
		name: "User interview",
		description: "Insights, quotes, opportunities, validation",
		sections:
			"### Interview Overview (participant / context / time)\n### Key Insights (insight + evidence)\n### Key Quotes (direct quotes, attributed)\n### Opportunity Points (opportunity + related insight)\n### Validation Plan (plan + owner + timeline)\nPreserve direct quotes as evidence; insights must be traceable.",
	},
] satisfies ReadonlyArray<{
	id: TemplateId;
	name: string;
	description: string;
	sections: string;
}>;
export const summaryPrompt = (id: TemplateId, language: string): string =>
	`You are a Professional Meeting Analyst. Produce generated meeting minutes from the transcript. Do not invent participants, decisions, owners or deadlines. Mark missing details as not recorded.\n${summaryTemplates.find((t) => t.id === id)?.sections ?? ""}\nPlease output the final meeting minutes in ${language}. Do not wrap the answer in Markdown code fences.`;
