import { Either, Schema } from "effect";
import { useState } from "react";
import type { KnobSlot } from "../../../../../../packages/device/src/knob/knob-contracts";
import {
	AssistantSettings,
	defaultAssistantSettings,
} from "../../../../../../packages/device/src/profiles/assistant-contracts";
import { ownModelRows } from "../../../../../../packages/edge/src/agents/agents-invariants";
import { Row } from "../ui/Form";
import { AssistantControls, useAssistantCatalog } from "./AssistantEditor";

export function KnobAssistantSettings({
	slot,
	original,
	onChange,
}: {
	readonly slot: KnobSlot;
	readonly original: unknown;
	readonly onChange: (slot: KnobSlot) => void;
}) {
	const { view, status } = useAssistantCatalog();
	const [review, setReview] = useState(false);
	const [stage, setStage] = useState("idle");
	const [invalid, setInvalid] = useState(false);
	const actions = slot.config.actions;
	const route = actions.find((a) => a.type === "voiceRoute")?.value;
	const originalActions = Array.isArray(original) ? original : [];
	const legacy = originalActions.find(
		(a: unknown) =>
			typeof a === "object" &&
			a !== null &&
			"type" in a &&
			a.type === "assistant",
	);
	const originalText =
		legacy && typeof legacy === "object" && "value" in legacy
			? typeof legacy.value === "string"
				? legacy.value
				: JSON.stringify(legacy.value)
			: "";
	const parsed = Schema.decodeUnknownEither(
		Schema.parseJson(AssistantSettings),
		{ onExcessProperty: "error" },
	)(actions.find((a) => a.type === "assistant")?.value ?? "");
	const settings =
		("assistantSettings" in slot.config
			? slot.config.assistantSettings
			: undefined) ??
		(Either.isRight(parsed) ? parsed.right : defaultAssistantSettings());
	const resolvedRow =
		(view?.models.default ?? []).find((r) => r.id === settings.modelRowId) ??
		(view?.models.default ?? []).find((r) => r.role === "default");
	const replacementProvider = settings.modelRowId || resolvedRow?.id || "";
	const replacementModel = settings.modelId || resolvedRow?.model || "";
	const update = (next: AssistantSettings) => {
		const valid = Schema.is(AssistantSettings)(next);
		setInvalid(!valid);
		if (!valid || slot.config.type === "") return;
		onChange({
			...slot,
			config: {
				...slot.config,
				assistantSettings: next,
				...(route === "legacyAssistant"
					? {
							actions: [
								{ type: "voiceRoute", value: "legacyAssistant" },
								{ type: "assistant", value: JSON.stringify(next) },
							],
						}
					: route === "direct"
						? {
								actions: [
									{ type: "voiceRoute", value: "direct" },
									{
										type: "directProvider",
										value:
											next.modelRowId || resolvedRow?.id || replacementProvider,
									},
									{
										type: "directModel",
										value:
											next.modelId ||
											(view?.models.default ?? []).find(
												(r) => r.id === next.modelRowId,
											)?.model ||
											resolvedRow?.model ||
											replacementModel,
									},
								],
							}
						: {}),
			},
		});
	};
	const agent = String(
		actions.find((a) => a.type === "agentId")?.value ?? "main",
	);
	const model = String(
		actions.find((a) => a.type === "dkclawModel")?.value ?? "",
	);
	const models =
		ownModelRows(view?.models ?? {}, agent) ?? view?.models.default ?? [];
	const selectAgent = (agentId: string, modelId: string) => {
		if (slot.config.type !== "")
			onChange({
				...slot,
				config: {
					...slot.config,
					actions: [
						{ type: "voiceRoute", value: "dkclaw" },
						{ type: "agentId", value: agentId },
						{ type: "dkclawModel", value: modelId },
					],
				},
			});
	};
	return (
		<section aria-label="Knob assistant configuration">
			{status && <p role="status">{status}</p>}
			<Row label="Assistant preview">
				<output
					className="knob-assistant-preview"
					data-stage={stage}
					aria-live="polite"
				>
					{stage === "recording"
						? "● Recording"
						: stage === "processing"
							? "◌ Processing"
							: "Assistant · Idle"}
				</output>
				{["idle", "recording", "processing"].map((s) => (
					<button
						key={s}
						type="button"
						aria-pressed={stage === s}
						onClick={() => setStage(s)}
					>
						{s}
					</button>
				))}
			</Row>
			{route === "dkclaw" ? (
				<>
					<Row label="Agent:" htmlFor="knob-agent">
						<select
							id="knob-agent"
							value={agent}
							onChange={(e) => selectAgent(e.target.value, "")}
						>
							{!(view?.agents ?? []).some((a) => a.id === agent) && (
								<option value={agent}>{agent} · unavailable</option>
							)}
							{(view?.agents ?? []).map((a) => (
								<option key={a.id} value={a.id}>
									{a.name}
								</option>
							))}
						</select>
					</Row>
					<Row label="Model:" htmlFor="knob-agent-model">
						<select
							id="knob-agent-model"
							value={model}
							onChange={(e) => selectAgent(agent, e.target.value)}
						>
							<option value="">Default (Agent)</option>
							{model &&
								!models.some((m) => `${m.provider}/${m.model}` === model) && (
									<option value={model}>{model} · unavailable</option>
								)}
							{models
								.filter((m) => m.model)
								.map((m) => (
									<option key={m.id} value={`${m.provider}/${m.model}`}>
										{m.provider} / {m.model}
									</option>
								))}
						</select>
					</Row>
					<p role="status">
						DK Claw knob capture is unavailable in this build. This assignment
						is saved for an agent-capable route; select Direct chat for capture.
					</p>
				</>
			) : (
				<>
					{route === "legacyAssistant" && (
						<>
							<p role="status">
								Legacy assistant is preserved and won't execute. Review and save
								a Direct chat replacement to enable capture.
							</p>
							<Row label="Preserved assistant JSON">
								<textarea
									aria-label="Preserved assistant JSON"
									readOnly
									rows={5}
									value={originalText}
								/>
							</Row>
							<button type="button" onClick={() => setReview(true)}>
								Preview migration
							</button>
							{review && (
								<section aria-label="Migration preview">
									<p>
										Replace legacy assistant with Direct chat using the selected
										local model. Imported credentials aren't copied.
									</p>
									<button
										type="button"
										disabled={!replacementProvider || !replacementModel}
										onClick={() => {
											if (slot.config.type !== "")
												onChange({
													...slot,
													config: {
														...slot.config,
														assistantSettings: settings,
														actions: [
															{ type: "voiceRoute", value: "direct" },
															{
																type: "directProvider",
																value: replacementProvider,
															},
															{ type: "directModel", value: replacementModel },
														],
													},
												});
											setReview(false);
										}}
									>
										Use reviewed replacement
									</button>
									<button type="button" onClick={() => setReview(false)}>
										Cancel migration
									</button>
								</section>
							)}
						</>
					)}
					<details>
						<summary>Assistant settings</summary>
						<AssistantControls
							value={settings}
							rows={view?.models.default ?? []}
							onChange={update}
						/>
					</details>
					{invalid && (
						<p role="alert">
							Assistant settings are outside the allowed bounds.
						</p>
					)}
				</>
			)}
		</section>
	);
}
