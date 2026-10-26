import { Schema } from "effect";
import type { AgentView, Skill } from "../../../../shared/agents";
import type { AgentRequest } from "./useAgents";
export const SKILL_DRAG_TYPE = "application/x-open-quake-skill";
const Payload = Schema.Struct({ owner: Schema.String, folder: Schema.String });
export function transferSkill(
	payload: string,
	target: string,
	view: AgentView,
	request: AgentRequest,
): void {
	const decoded = Schema.decodeUnknownEither(Schema.parseJson(Payload))(
		payload,
		{ onExcessProperty: "error" },
	);
	if (
		decoded._tag === "Left" ||
		target === "main" ||
		decoded.right.owner === target ||
		!view.agents.some((a) => a.id === target)
	)
		return;
	const skill = view.skills.find(
		(s) => s.owner === decoded.right.owner && s.folder === decoded.right.folder,
	);
	if (skill)
		void request({
			type: "move-skill",
			folder: skill.folder,
			owner: skill.owner,
			target,
			revision: view.revision,
		});
}
export const skillDragPayload = (skill: Skill): string =>
	JSON.stringify({ owner: skill.owner, folder: skill.folder });
