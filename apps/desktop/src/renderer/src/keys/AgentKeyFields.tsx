import { useState } from "react";
import type { ProfileKey } from "../../../../../../packages/device/src/profiles/profile-contracts";
import { ConnectionForm } from "../management/agent-http/ConnectionForm";
import { useConnections } from "../management/agent-http/useConnections";
import { useAgentsCopy } from "../management/agents/copy";
import { Row } from "../ui/Form";
import { AgentRouteFields } from "./AgentRouteFields";

export function AgentKeyFields({
	value,
	onChange,
}: {
	readonly value: ProfileKey;
	readonly onChange: (key: ProfileKey) => void;
}) {
	const copy = useAgentsCopy().keyFields;
	const [gateway, setGateway] = useState(false);
	const [notice, setNotice] = useState("");
	const [resetting, setResetting] = useState(false);
	const connections = useConnections(window.quakeAgentConnections);
	const connection = connections.view?.connections.find(
		(c) => c.id === connections.view?.selected?.connectionId,
	);
	const action = (type: string) =>
		value.config.actions.find((a) => a.type === type)?.value;
	const patch = (type: string, next: string | boolean) =>
		onChange({
			...value,
			config: {
				...value.config,
				actions: [
					...value.config.actions.filter((a) => a.type !== type),
					{ type, value: next },
				],
			},
		});
	return (
		<section aria-label={copy.title}>
			<AgentRouteFields
				agent={String(action("agentId") || "main")}
				model={String(action("model") || "")}
				onAgent={(id) => patch("agentId", id)}
				onModel={(id) => patch("model", id)}
			/>
			<Row label={copy.voice} htmlFor="agent-key-voice">
				<input
					id="agent-key-voice"
					type="checkbox"
					checked={action("voiceInput") !== false}
					onChange={(e) => patch("voiceInput", e.target.checked)}
				/>
			</Row>
			{action("voiceInput") === false && (
				<Row label={copy.task} htmlFor="agent-key-task">
					<textarea
						id="agent-key-task"
						value={String(action("taskPrompt") ?? "")}
						onChange={(e) => patch("taskPrompt", e.target.value)}
					/>
				</Row>
			)}
			<button
				type="button"
				disabled={resetting}
				onClick={() => {
					setResetting(true);
					void window.quakeVoice
						?.request({ _tag: "ResetContext", keyCode: value.keyCode })
						.then(
							(reply) => {
								setNotice(
									typeof reply === "object" &&
										reply !== null &&
										"_tag" in reply &&
										reply._tag === "ok"
										? copy.resetDone
										: copy.unavailable,
								);
							},
							() => setNotice(copy.unavailable),
						)
						.finally(() => setResetting(false));
					if (!window.quakeVoice) {
						setNotice(copy.unavailable);
						setResetting(false);
					}
				}}
			>
				{copy.reset}
			</button>
			<button
				type="button"
				onClick={() => setGateway(!gateway)}
				aria-expanded={gateway}
			>
				{copy.gateway}
			</button>
			{gateway && (
				<ConnectionForm
					existing={connection}
					busy={connections.busy}
					onSave={async (draft) => {
						const reply = await connections.saveAndSelect({
							type: "save",
							...(connection ? { id: connection.id } : {}),
							name: draft.name,
							kind: draft.kind,
							baseURL: draft.baseURL,
							...(draft.credential ? { credential: draft.credential } : {}),
							...(draft.clearCredential ? { clearCredential: true } : {}),
						});
						if (reply?._tag === "success") {
							setGateway(false);
							return true;
						}
						return false;
					}}
					onCancel={() => setGateway(false)}
				/>
			)}
			{connections.error && <p role="alert">{connections.error.message}</p>}
			{notice && <p role="status">{notice}</p>}
		</section>
	);
}
