import { resolveModelRows } from "../../../../../../packages/edge/src/agents/agents-invariants";
import { useAgentsCopy } from "../management/agents/copy";
import { useAgents } from "../management/agents/useAgents";
import { Row } from "../ui/Form";

/** Local workspace identities stay distinct from the selected external runtime identity. */
export function AgentRouteFields({
	idPrefix,
	agent,
	model,
	onAgent,
	onModel,
}: {
	readonly idPrefix: string;
	readonly agent: string;
	readonly model: string;
	readonly onAgent: (id: string) => void;
	readonly onModel: (id: string) => void;
}) {
	const { view } = useAgents(window.quakeAgents);
	const copy = useAgentsCopy().keyFields;
	const agents = view?.agents ?? [];
	const models = resolveModelRows(
		view?.models[agent === "main" ? "default" : agent] ??
			view?.models.default ??
			[],
	);
	return (
		<>
			<Row label={copy.agent} htmlFor={`${idPrefix}-local-agent`}>
				<select
					id={`${idPrefix}-local-agent`}
					value={agent || "main"}
					onChange={(e) => onAgent(e.target.value)}
				>
					<option value="main">{copy.defaultAgent}</option>
					{agent && agent !== "main" && !agents.some((a) => a.id === agent) && (
						<option value={agent}>{agent}</option>
					)}
					{agents
						.filter((a) => a.id !== "main")
						.map((a) => (
							<option key={a.id} value={a.id}>
								{a.name}
							</option>
						))}
				</select>
			</Row>
			<Row label={copy.model} htmlFor={`${idPrefix}-local-agent-model`}>
				<select
					id={`${idPrefix}-local-agent-model`}
					value={model}
					disabled={!agent}
					onChange={(e) => onModel(e.target.value)}
				>
					<option value="">{copy.defaultModel}</option>
					{model && !models.some((m) => m.model === model) && (
						<option value={model}>{model}</option>
					)}
					{[...new Set(models.map((m) => m.model).filter(Boolean))].map(
						(id) => (
							<option key={id}>{id}</option>
						),
					)}
				</select>
			</Row>
		</>
	);
}
