import { Either, Schema } from "effect";
import { useEffect, useId, useState } from "react";
import {
	AssistantSettings,
	assistantSettingsFromActions,
} from "../../../../../../packages/device/src/profiles/assistant-contracts";
import type { ProfileKey } from "../../../../../../packages/device/src/profiles/profile-contracts";
import { resolveModelRows } from "../../../../../../packages/edge/src/agents/agents-invariants";
import { ROLE_PRESETS } from "../../../../../../packages/edge/src/ai/ai-role-presets";
import { providerSamplingValid } from "../../../../../../packages/edge/src/ai/ai-sampling";
import {
	canonicalProvider,
	modelOptions,
	supportsWebSearch,
} from "../../../../../../packages/edge/src/ai/provider-catalog";
import type { AgentView, PublicModelRow } from "../../../shared/agents";
import { useAppLocale } from "../i18n";
import { Row } from "../ui/Form";
import { AssistantLink } from "./AssistantLink";
import { useAssistantText } from "./assistant-copy";

export const ASSISTANT_ENGINES = [
	{ id: "qwen", label: "QWen" },
	{ id: "kimi", label: "Kimi" },
	{ id: "deepseek", label: "DeepSeek" },
	{ id: "openai", label: "OpenAI" },
] as const;
export function useAssistantCatalog() {
	const t = useAssistantText();
	const [view, setView] = useState<AgentView>();
	const [status, setStatus] = useState(t("Loading saved providers…"));
	useEffect(() => {
		let alive = true;
		const bridge = window.quakeAgents;
		if (!bridge) {
			setStatus(t("Saved providers are unavailable."));
			return;
		}
		void bridge
			.request({ type: "read" })
			.then((reply) => {
				if (!alive) return;
				if (reply._tag === "success") {
					setView(reply.view);
					setStatus("");
				} else setStatus(reply.message);
			})
			.catch(() => {
				if (alive) setStatus(t("Saved providers couldn't be loaded."));
			});
		const off = bridge.onSnapshot((next) => {
			if (alive) {
				setView(next);
				setStatus("");
			}
		});
		return () => {
			alive = false;
			off();
		};
	}, [t]);
	return { view, status, setView };
}
export function AssistantControls({
	value,
	onChange,
	rows,
	disabled = false,
}: {
	readonly value: AssistantSettings;
	readonly onChange: (value: AssistantSettings) => void;
	readonly rows: readonly PublicModelRow[];
	readonly disabled?: boolean;
}) {
	const t = useAssistantText();
	const id = useId();
	const { locale } = useAppLocale();
	const [filter, setFilter] = useState("");
	const [entities, setEntities] = useState<readonly string[]>([]);
	const [haStatus, setHaStatus] = useState("");
	const eligible = resolveModelRows(rows);
	const row = value.modelRowId
		? eligible.find((r) => r.id === value.modelRowId)
		: eligible.find((r) => r.role === "default");
	const model = value.modelId || row?.model || "";
	const thinking =
		row &&
		(canonicalProvider(row.provider) === "qwen" ||
			(canonicalProvider(row.provider) === "openai" && model === "gpt-5.1") ||
			(canonicalProvider(row.provider) === "kimi" && model === "kimi-k2.6"));
	const sampling =
		row &&
		providerSamplingValid({
			provider: row.provider,
			model,
			temperature: value.temperature,
			topP: value.topP,
		});
	const patch = (next: Partial<AssistantSettings>) =>
		onChange({ ...value, ...next });
	const check = (
		label: string,
		field:
			| "thinking"
			| "webSearch"
			| "homeAssistantControl"
			| "enableVoiceInput"
			| "enableWakeTalkWindow"
			| "useAgent",
		unavailable = false,
	) => (
		<Row label={label} htmlFor={`${id}-${field}`}>
			<input
				id={`${id}-${field}`}
				type="checkbox"
				checked={value[field]}
				disabled={unavailable}
				onChange={(e) => {
					const enabled = e.target.checked;
					patch({
						[field]: enabled,
						...(field === "useAgent" && enabled
							? { enableWakeTalkWindow: false, enableVoiceInput: true }
							: {}),
						...(field === "enableWakeTalkWindow" && enabled
							? { useAgent: false }
							: {}),
						...(field === "enableVoiceInput" && !enabled
							? { useAgent: false }
							: {}),
					});
				}}
			/>
		</Row>
	);
	return (
		<fieldset disabled={disabled} aria-label="Assistant controls">
			<Row label={t("Direct provider")} htmlFor={`${id}-engine`}>
				<select
					id={`${id}-engine`}
					value={canonicalProvider(row?.provider ?? "")}
					onChange={(e) => {
						const selected = rows.find(
							(r) => canonicalProvider(r.provider) === e.target.value,
						);
						if (selected)
							patch({
								modelRowId: selected.id,
								modelId: "",
								thinking: false,
								webSearch: false,
							});
					}}
				>
					<option value="" disabled>
						{t("Select AI chat provider")}
					</option>
					{!ASSISTANT_ENGINES.some(
						(e) => e.id === canonicalProvider(row?.provider ?? ""),
					) &&
						row && (
							<option value={canonicalProvider(row.provider)}>
								{row.provider}
							</option>
						)}
					{ASSISTANT_ENGINES.map((e) => (
						<option
							key={e.id}
							value={e.id}
							disabled={
								!rows.some((r) => canonicalProvider(r.provider) === e.id)
							}
						>
							{e.label}
							{rows.some((r) => canonicalProvider(r.provider) === e.id)
								? ""
								: " · not configured"}
						</option>
					))}
				</select>
			</Row>
			<Row label={t("Model")} htmlFor={`${id}-model`}>
				<select
					id={`${id}-model`}
					value={value.modelRowId}
					onChange={(e) =>
						patch({
							modelRowId: e.target.value,
							modelId: "",
							thinking: false,
							webSearch: false,
						})
					}
				>
					<option value="">{t("General Settings default")}</option>
					{value.modelRowId && !rows.some((r) => r.id === value.modelRowId) && (
						<option value={value.modelRowId}>
							{value.modelRowId} · unavailable
						</option>
					)}
					{rows.map((r) => (
						<option key={r.id} value={r.id} disabled={!eligible.includes(r)}>
							{r.name ?? `${r.provider} / ${r.model || "Model not set"}`}
							{!eligible.includes(r)
								? " · unavailable"
								: r.credentialAvailable
									? ""
									: " · credentials required"}
						</option>
					))}
				</select>
			</Row>
			<Row label={t("Model ID")} htmlFor={`${id}-model-id`}>
				<input
					id={`${id}-model-id`}
					value={value.modelId}
					placeholder={row?.model}
					list={`${id}-models`}
					maxLength={200}
					onChange={(e) =>
						patch({
							modelId: e.target.value,
							thinking: false,
							webSearch: false,
						})
					}
				/>
				<datalist id={`${id}-models`}>
					{row &&
						modelOptions(row.provider, [row.model, value.modelId]).map((m) => (
							<option key={m.id} value={m.id}>
								{m.label}
							</option>
						))}
				</datalist>
			</Row>
			{row && !row.credentialAvailable && (
				<p role="status">
					{t("Add credentials in Models before using this assistant.")}
				</p>
			)}
			{check(t("Use Dekie Agent"), "useAgent")}
			<p className="cw-muted">
				{t(
					"After closing, only the chat function will be available, and device control will be disabled.",
				)}
			</p>
			<p role="status">
				{t(
					"Auto supports chat and allowed Home Assistant entities. Other device control routes are unavailable in this build.",
				)}
			</p>
			{check(t("Voice Input"), "enableVoiceInput")}
			{check(t("Wake Chat Window"), "enableWakeTalkWindow")}
			<Row label={t("Chat history count")} htmlFor={`${id}-history`}>
				<input
					id={`${id}-history`}
					type="number"
					min={0}
					max={50}
					value={value.chatHistoryCount}
					onChange={(e) => patch({ chatHistoryCount: e.target.valueAsNumber })}
				/>
			</Row>
			<Row label={t("Custom Role")} htmlFor={`${id}-custom`}>
				<input
					id={`${id}-custom`}
					type="checkbox"
					checked={value.roleId === -1}
					onChange={(e) =>
						patch({ roleId: e.target.checked ? -1 : 0, customPrompt: "" })
					}
				/>
			</Row>
			{value.roleId === -1 ? (
				<Row label={t("Role Prompt")} htmlFor={`${id}-prompt`}>
					<textarea
						id={`${id}-prompt`}
						rows={5}
						maxLength={3000}
						value={value.customPrompt}
						placeholder="Enter a custom role prompt"
						onChange={(e) => patch({ customPrompt: e.target.value })}
					/>
					<span>{value.customPrompt.length} / 3000</span>
				</Row>
			) : (
				<>
					<Row label={t("Filter roles")} htmlFor={`${id}-filter`}>
						<input
							id={`${id}-filter`}
							value={filter}
							onChange={(e) => setFilter(e.target.value)}
						/>
					</Row>
					<Row label={t("System Role")} htmlFor={`${id}-role`}>
						<select
							id={`${id}-role`}
							value={value.roleId}
							onChange={(e) =>
								patch({ roleId: Number(e.target.value), customPrompt: "" })
							}
						>
							{ROLE_PRESETS.filter(
								(r) =>
									r.id === value.roleId ||
									r.names[locale].toLowerCase().includes(filter.toLowerCase()),
							).map((r) => (
								<option key={r.id} value={r.id}>
									{r.names[locale]}
								</option>
							))}
						</select>
					</Row>
				</>
			)}
			{check(t("Enable Thinking"), "thinking", !thinking)}
			{!thinking && (
				<p role="status">
					{t("Thinking is unsupported by this provider/model.")}
				</p>
			)}
			{check(
				t("Web Search"),
				"webSearch",
				Boolean(row && !supportsWebSearch(row.provider, model)),
			)}
			{row && !supportsWebSearch(row.provider, model) && (
				<p role="status">
					{t("Web Search is unsupported by this provider/model.")}
				</p>
			)}
			{(
				[
					{
						field: "topP",
						label: t("Personality"),
						max: 1,
						left: "Fastidious",
						right: "Flexible",
					},
					{
						field: "temperature",
						label: t("Reply Quality"),
						max: 2,
						left: "Conservative",
						right: "Gibberish",
					},
				] as const
			).map((s) => (
				<Row key={s.field} label={s.label} htmlFor={`${id}-${s.field}`}>
					<input
						id={`${id}-${s.field}`}
						type="range"
						min={0}
						max={s.max}
						step={0.05}
						value={value[s.field]}
						disabled={!sampling}
						onChange={(e) => patch({ [s.field]: e.target.valueAsNumber })}
					/>
					<output>{value[s.field]}</output>
					<span>
						{t(s.left)} / {t(s.right)}
					</span>
				</Row>
			))}
			{!sampling && (
				<p role="status">
					{t(
						"This provider/model requires its own sampling values. Saved assistant slider values are retained; provider defaults apply.",
					)}
				</p>
			)}
			<Row label={t("Chat Timeout(s)")} htmlFor={`${id}-timeout`}>
				<input
					id={`${id}-timeout`}
					type="range"
					min={5}
					max={30}
					step={5}
					value={value.contextTimeoutSeconds}
					onChange={(e) =>
						patch({ contextTimeoutSeconds: e.target.valueAsNumber })
					}
				/>
				<output>{value.contextTimeoutSeconds}</output>
			</Row>
			{value.useAgent && (
				<>
					{check(t("HomeAssistant Control"), "homeAssistantControl")}
					<Row label={t("HA Configuration")}>
						<AssistantLink page="home-assistant">
							{t("HA Configuration")}
						</AssistantLink>
						<button
							type="button"
							onClick={() => {
								setHaStatus("Loading allowed entities…");
								const request = window.quakeIntegrations?.request({
									type: "ha.read",
								});
								if (!request) {
									setHaStatus("Home Assistant is unavailable.");
									return;
								}
								void request
									.then((r) => {
										if (r.type === "ha") {
											setEntities(r.snapshot.allowlist);
											setHaStatus(
												r.snapshot.state === "Connected"
													? ""
													: "Home Assistant is disconnected.",
											);
										} else setHaStatus("Home Assistant is unavailable.");
									})
									.catch(() =>
										setHaStatus("Home Assistant couldn't be loaded."),
									);
							}}
						>
							{t("Select entities")}
						</button>
					</Row>
					{[...new Set([...entities, ...value.entityIds])].map((entity) => (
						<label key={entity}>
							<input
								type="checkbox"
								checked={value.entityIds.includes(entity)}
								disabled={
									!entities.includes(entity) &&
									!value.entityIds.includes(entity)
								}
								onChange={(e) =>
									patch({
										entityIds: e.target.checked
											? [...value.entityIds, entity]
											: value.entityIds.filter((x) => x !== entity),
									})
								}
							/>
							{entity}
							{entities.includes(entity) ? "" : " · not currently allowed"}
						</label>
					))}
					{haStatus && <p role="status">{haStatus}</p>}
				</>
			)}
			<p>
				<AssistantLink page="openclaw-ai">{t("Models")}</AssistantLink> ·{" "}
				<AssistantLink page="settings">{t("Speech settings")}</AssistantLink>
			</p>
		</fieldset>
	);
}
export function AssistantEditor({
	keyValue,
	onChange,
	disabled = false,
}: {
	readonly keyValue: ProfileKey;
	readonly onChange: (key: ProfileKey) => void;
	readonly disabled?: boolean;
}) {
	const t = useAssistantText();
	const { view, status } = useAssistantCatalog();
	const rows = view?.models.default ?? [];
	const value =
		keyValue.config.assistantSettings ??
		assistantSettingsFromActions(keyValue.config.actions);
	const [invalid, setInvalid] = useState(false);
	const selected = rows.find((r) => r.role === "default");
	return (
		<section aria-label={t("Assistant settings")}>
			{!keyValue.config.assistantSettings && (
				<button
					type="button"
					disabled={disabled}
					onClick={() =>
						onChange({
							...keyValue,
							config: {
								...keyValue.config,
								assistantSettings: value,
							},
						})
					}
				>
					{t("Configure assistant")}
				</button>
			)}
			<Row label={t("AI Model Provider")}>
				<span>
					{ASSISTANT_ENGINES.find(
						(engine) =>
							engine.id === canonicalProvider(selected?.provider ?? ""),
					)?.label ??
						selected?.provider ??
						t("Unconfigured")}
				</span>
				<AssistantLink page="settings">
					{t("Change the AI provider in General Settings")}
				</AssistantLink>
			</Row>
			{status && <p role="status">{status}</p>}
			<AssistantControls
				value={value}
				rows={rows}
				disabled={disabled}
				onChange={(next) => {
					const decoded = Schema.decodeUnknownEither(AssistantSettings, {
						onExcessProperty: "error",
					})(next);
					setInvalid(Either.isLeft(decoded));
					if (Either.isRight(decoded))
						onChange({
							...keyValue,
							config: { ...keyValue.config, assistantSettings: decoded.right },
						});
				}}
			/>
			{invalid && (
				<p role="alert">
					{t("Assistant settings are outside the allowed bounds.")}
				</p>
			)}
		</section>
	);
}
