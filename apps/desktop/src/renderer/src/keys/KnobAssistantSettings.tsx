import { Either, Schema } from "effect";
import { useState } from "react";
import type { KnobSlot } from "../../../../../../packages/device/src/knob/knob-contracts";
import {
	AssistantSettings,
	defaultAssistantSettings,
} from "../../../../../../packages/device/src/profiles/assistant-contracts";
import { previewLegacyAssistant } from "../../../../../../packages/device/src/profiles/assistant-legacy";
import { Row } from "../ui/Form";
import { AgentRouteFields } from "./AgentRouteFields";
import { AssistantControls, useAssistantCatalog } from "./AssistantEditor";
import { useAssistantText } from "./assistant-copy";

export function KnobAssistantSettings({
	slot,
	original,
	onChange,
}: {
	readonly slot: KnobSlot;
	readonly original: unknown;
	readonly onChange: (slot: KnobSlot) => void;
}) {
	const t = useAssistantText();
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
	const fallback = {
		...defaultAssistantSettings(),
		modelRowId: String(
			actions.find((a) => a.type === "directProvider")?.value ?? "",
		),
		modelId: String(actions.find((a) => a.type === "directModel")?.value ?? ""),
	};
	const settings =
		("assistantSettings" in slot.config
			? slot.config.assistantSettings
			: undefined) ??
		(Either.isRight(parsed)
			? parsed.right
			: route === "legacyAssistant"
				? {
						...previewLegacyAssistant(originalText),
						modelRowId: fallback.modelRowId,
					}
				: fallback);
	const resolvedRow =
		(view?.models.default ?? []).find((r) => r.id === settings.modelRowId) ??
		(view?.models.default ?? []).find((r) => r.role === "default");
	const replacementProvider = settings.modelRowId || resolvedRow?.id || "";
	const replacementModel = settings.modelId || resolvedRow?.model || "";
	const update = (next: AssistantSettings) => {
		const nextRow = next.modelRowId
			? (view?.models.default ?? []).find((r) => r.id === next.modelRowId)
			: (view?.models.default ?? []).find((r) => r.role === "default");
		const valid = Schema.is(AssistantSettings)(next);
		setInvalid(!valid);
		if (!valid || slot.config.type === "") return;
		onChange({
			...slot,
			config: {
				...slot.config,
				assistantSettings: next,
				...(route === "direct"
					? {
							actions: [
								{ type: "voiceRoute", value: "direct" },
								{
									type: "directProvider",
									value: next.modelRowId || nextRow?.id || "",
								},
								{
									type: "directModel",
									value: next.modelId || nextRow?.model || "",
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
	const selectAgent = (agentId: string, modelId: string) => {
		if (slot.config.type !== "")
			onChange({
				...slot,
				config: {
					...slot.config,
					actions: [
						{ type: "voiceRoute", value: "dkclaw" },
						{ type: "agentId", value: agentId },
						...(modelId ? [{ type: "dkclawModel", value: modelId }] : []),
					],
				},
			});
	};
	return (
		<section aria-label="Knob assistant configuration">
			{status && <p role="status">{status}</p>}
			<Row label={t("Assistant preview")}>
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
					<AgentRouteFields
						idPrefix="knob"
						agent={agent}
						model={model}
						onAgent={(id) => selectAgent(id, "")}
						onModel={(id) => selectAgent(agent, id)}
					/>
					<p role="status">
						{t(
							"Capture requires a connected agent runtime with this saved agent. The default model is used when no model is selected.",
						)}
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
							<Row label={t("Preserved assistant JSON")}>
								<textarea
									aria-label={t("Preserved assistant JSON")}
									readOnly
									rows={5}
									value={originalText}
								/>
							</Row>
							<button type="button" onClick={() => setReview(true)}>
								{t("Preview migration")}
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
										{t("Use reviewed replacement")}
									</button>
									<button type="button" onClick={() => setReview(false)}>
										{t("Cancel migration")}
									</button>
								</section>
							)}
						</>
					)}
					<details>
						<summary>{t("Assistant settings")}</summary>
						<AssistantControls
							value={settings}
							rows={view?.models.default ?? []}
							onChange={update}
						/>
					</details>
					{invalid && (
						<p role="alert">
							{t("Assistant settings are outside the allowed bounds.")}
						</p>
					)}
				</>
			)}
		</section>
	);
}
