import type { AgentReply } from "../../../../shared/agents";
import type { AgentRequest } from "./useAgents";
/** Save only dirty tabs, advancing the shared revision after each durable reply. */
export async function saveWorkspaceFiles(input: {
	readonly id: string;
	readonly files: Readonly<Record<string, string>>;
	readonly saved: Readonly<Record<string, string>>;
	readonly revision: number;
	readonly request: AgentRequest;
	readonly onSaved: (file: string, content: string) => void;
}): Promise<Extract<AgentReply, { readonly _tag: "rejected" }> | undefined> {
	let revision = input.revision;
	for (const [file, content] of Object.entries(input.files)) {
		if (input.saved[file] === content) continue;
		const reply = await input.request({
			type: "save-file",
			id: input.id,
			file,
			content,
			revision,
		});
		if (reply._tag === "rejected") return reply;
		revision = reply.view.revision;
		input.onSaved(file, content);
	}
	return;
}
