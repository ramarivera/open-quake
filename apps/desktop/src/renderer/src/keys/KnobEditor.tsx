import { Either, Option } from "effect";
import { useEffect, useRef, useState } from "react";
import {
	KNOB_SLOT_INDEX,
	type KnobSlotName,
} from "../../../../../../packages/device/src/knob/knob-contracts.js";
import { migrateKnobVoiceActions } from "../../../../../../packages/device/src/knob/knob-voice-migration.js";
import type {
	Profile,
	ProfileEnvelope,
} from "../../../../../../packages/device/src/profiles/profile-contracts.js";
import { resolveModelRows } from "../../../../../../packages/edge/src/agents/agents-invariants";
import type { PublicModelRow } from "../../../shared/agents";
import { Group, Row } from "../ui/Form";
import {
	editKnobSlot,
	knobAssignment,
	knobVoiceReady,
	profileKnobDraft,
} from "./knob-draft";

/** Mounted with the profile ID as key. Page selection leaves this draft intact. */
export function KnobEditor({
	profile,
	accept,
	keyEditOpen = false,
}: {
	readonly profile: Profile;
	readonly keyEditOpen?: boolean;
	readonly accept: (envelope: typeof ProfileEnvelope.Encoded) => void;
}): React.JSX.Element {
	const [draft, setDraft] = useState(() => profileKnobDraft(profile));
	const [revision, setRevision] = useState(profile.revision);
	const [slotName, setSlotName] = useState<KnobSlotName>("center");
	const [savedModels, setModels] = useState<readonly PublicModelRow[]>([]);
	const [catalogState, setCatalogState] = useState("Loading saved providers…");
	const [notice, setNotice] = useState("");
	const [saving, setSaving] = useState(false);
	const alive = useRef(true);
	const pending = useRef(false);
	const [previewed, setPreviewed] = useState(false);
	const [reviewed, setReviewed] = useState(false);
	useEffect(() => {
		alive.current = true;
		const read = async () => {
			try {
				const reply = await window.quakeAgents.request({ type: "read" });
				if (!alive.current) return;
				if (reply._tag === "success") {
					setModels(reply.view.models.default ?? []);
					setCatalogState("");
				} else setCatalogState(reply.message);
			} catch {
				if (alive.current)
					setCatalogState("Saved providers couldn't be loaded.");
			}
		};
		void read();
		const off = window.quakeAgents.onSnapshot((view) => {
			setModels(view.models.default ?? []);
			setCatalogState("");
		});
		return () => {
			alive.current = false;
			off();
		};
	}, []);
	const models = resolveModelRows(savedModels);
	const slot = draft.config.subActions[KNOB_SLOT_INDEX[slotName]];
	const value = (type: string) =>
		slot.config.actions.find((a) => a.type === type)?.value;
	const route = value("voiceRoute");
	const provider = value("directProvider");
	const model = value("directModel");
	const selected = models.find((m) => m.id === provider && m.model === model);
	const center = draft.config.subActions[0];
	const centerDirect =
		center.config.type === "assistant" &&
		center.config.actions.find((a) => a.type === "voiceRoute")?.value ===
			"direct";
	const ready = knobVoiceReady(draft, models);
	const sourceCenter = Option.isSome(profile.knob)
		? profile.knob.value.config.subActions
		: undefined;
	const rawCenter = Array.isArray(sourceCenter) ? sourceCenter[0] : undefined;
	const sourceActions =
		typeof rawCenter === "object" &&
		rawCenter !== null &&
		"config" in rawCenter &&
		typeof rawCenter.config === "object" &&
		rawCenter.config !== null &&
		"actions" in rawCenter.config
			? rawCenter.config.actions
			: undefined;
	const preview = migrateKnobVoiceActions(
		sourceActions ?? center.config.actions,
		{
			providers: models.map((m) => ({
				id: m.id,
				provider: m.provider,
				modelId: m.model,
			})),
		},
	);
	const needsReview =
		sourceActions !== undefined &&
		Either.isRight(preview) &&
		preview.right.actions.some(
			(a) => a.type === "voiceRoute" && a.value === "direct",
		) &&
		JSON.stringify(sourceActions) !== JSON.stringify(preview.right.actions) &&
		!reviewed;
	const replace = (next: typeof slot) => {
		setDraft(editKnobSlot(draft, slotName, next));
		setNotice("");
	};
	const changeDirect = (providerId: string, modelId: string) =>
		replace({
			childrenName: "assistant",
			config: {
				type: "assistant",
				actions: [
					{ type: "voiceRoute", value: "direct" },
					{ type: "directProvider", value: providerId },
					{ type: "directModel", value: modelId },
				],
			},
		});
	const save = async () => {
		if (pending.current || keyEditOpen) return;
		pending.current = true;
		setSaving(true);
		setNotice("");
		try {
			const reply = await window.quakeKeyLibrary.request({
				type: "save-knob",
				profileId: profile.id,
				revision,
				knob: draft,
			});
			if (!alive.current) return;
			if (reply._tag === "rejected") {
				setNotice(reply.reason);
				return;
			}
			if (reply.envelope) {
				accept(reply.envelope);
				setRevision(
					reply.envelope.profiles.find((p) => p.id === profile.id)?.revision ??
						revision,
				);
			}
			setNotice("Knob voice settings saved");
		} catch {
			if (alive.current)
				setNotice("Knob settings couldn't be saved. Try again.");
		} finally {
			pending.current = false;
			if (alive.current) setSaving(false);
		}
	};
	return (
		<Group
			title="Knob voice & chat"
			description="Configure this profile's knob. Idle rotation selects profiles."
			footer={notice ? <span role="status">{notice}</span> : undefined}
		>
			<fieldset
				disabled={saving}
				className="knob-editor"
				aria-label="Knob settings"
			>
				<Row label="Slot">
					{(["left", "center", "right"] as const).map((name) => (
						<button
							key={name}
							type="button"
							aria-pressed={name === slotName}
							onClick={() => setSlotName(name)}
						>
							{name === "center"
								? "Center"
								: name === "left"
									? "Left"
									: "Right"}
						</button>
					))}
				</Row>
				<Row label="Function" htmlFor="knob-function">
					<select
						id="knob-function"
						value={slot.config.type}
						onChange={(e) => {
							replace(knobAssignment(e.target.value));
							if (slotName === "center") setReviewed(true);
						}}
					>
						<option value="">None</option>
						{slotName === "center" && (
							<option value="assistant">Knob press-and-hold voice</option>
						)}
						<option value="panelBrightness">Panel brightness</option>
						<option value="previousPage">Previous page</option>
						<option value="nextPage">Next page</option>
						<option value="goToPage">Go to page</option>
					</select>
				</Row>
				{slot.config.type === "assistant" && (
					<>
						<Row label="Voice route:" htmlFor="knob-route">
							<select
								id="knob-route"
								value={String(route ?? "")}
								onChange={() => {
									changeDirect("", "");
									setReviewed(true);
								}}
							>
								{route !== "direct" && (
									<option value={String(route ?? "")} disabled>
										{route === "dkclaw"
											? "DK Claw (OpenClaw)"
											: "Legacy assistant"}{" "}
										· unavailable
									</option>
								)}
								<option value="direct">Direct chat</option>
							</select>
						</Row>
						{route === "direct" && (
							<>
								<Row label="Chat provider:" htmlFor="knob-provider">
									<select
										id="knob-provider"
										value={typeof provider === "string" ? provider : ""}
										onChange={(e) => {
											changeDirect(e.target.value, "");
											setReviewed(true);
										}}
									>
										<option value="">Select saved provider</option>
										{typeof provider === "string" &&
											provider &&
											!models.some((m) => m.id === provider) && (
												<option value={provider}>
													Saved provider unavailable
												</option>
											)}
										{models.map((m) => (
											<option key={m.id} value={m.id}>
												{m.provider} / {m.model || "Model not set"}
											</option>
										))}
									</select>
								</Row>
								<Row label="Chat model:" htmlFor="knob-model">
									<select
										id="knob-model"
										value={typeof model === "string" ? model : ""}
										disabled={!provider}
										onChange={(e) => {
											changeDirect(String(provider ?? ""), e.target.value);
											setReviewed(true);
										}}
									>
										<option value="">Select model</option>
										{typeof model === "string" &&
											model &&
											!models.some(
												(m) => m.id === provider && m.model === model,
											) && <option value={model}>{model} · unavailable</option>}
										{models
											.filter((m) => m.id === provider && m.model.trim())
											.map((m) => (
												<option key={m.id} value={m.model}>
													{m.model}
												</option>
											))}
									</select>
								</Row>
								{selected && !selected.credentialAvailable && (
									<Row label="Credentials">
										<span role="status">
											Add credentials in Models before using voice capture.
										</span>
									</Row>
								)}
							</>
						)}
					</>
				)}
				{(slot.config.type === "panelBrightness" ||
					slot.config.type === "goToPage") && (
					<Row
						label={slot.config.type === "goToPage" ? "Page" : "Step percent"}
						htmlFor="knob-number"
					>
						<input
							id="knob-number"
							type="number"
							min={1}
							max={
								slot.config.type === "panelBrightness"
									? 100
									: profile.pages.length
							}
							value={Number(
								value(slot.config.type === "goToPage" ? "page" : "stepPercent"),
							)}
							onChange={(e) =>
								replace({
									...slot,
									config: {
										...slot.config,
										actions: [
											{
												type:
													slot.config.type === "goToPage"
														? "page"
														: "stepPercent",
												value: e.target.valueAsNumber,
											},
										],
									},
								})
							}
						/>
					</Row>
				)}
				{catalogState && (
					<Row label="Saved providers">
						<span role="status">{catalogState}</span>{" "}
						<button type="button" onClick={() => window.location.reload()}>
							Reload
						</button>
					</Row>
				)}
				{needsReview && (
					<Row label="Imported route">
						<button type="button" onClick={() => setPreviewed(true)}>
							Review imported route
						</button>
						{previewed && Either.isRight(preview) && (
							<div>
								<p>
									{preview.right.status === "ready"
										? "Saved provider and model resolved. Review before saving."
										: "Choose a saved provider and model. The imported route needs configuration."}
								</p>
								<button
									type="button"
									disabled={preview.right.status !== "ready"}
									onClick={() => {
										const result = preview.right;
										setDraft(
											editKnobSlot(draft, "center", {
												childrenName: "assistant",
												config: { type: "assistant", actions: result.actions },
											}),
										);
										setReviewed(true);
									}}
								>
									Use reviewed route
								</button>
							</div>
						)}
					</Row>
				)}
				<Row label="Capture">
					<span role="status">
						{center.config.type !== "assistant"
							? "Assign knob press-and-hold voice to enable capture."
							: ready
								? "Provider and model ready. Speech settings are required to record."
								: "Unavailable. Choose a saved provider and model with credentials."}
					</span>
				</Row>
				{keyEditOpen && (
					<Row label="Key edit">
						<span role="status">
							Save your key changes, then close the key editor with Cancel
							before saving knob settings.
						</span>
					</Row>
				)}
				<Row label="">
					<button
						type="button"
						className="button-primary"
						disabled={keyEditOpen || needsReview || (centerDirect && !ready)}
						onClick={() => void save()}
					>
						{saving ? "Saving…" : "Save knob"}
					</button>
					<button
						type="button"
						onClick={() => {
							setDraft(profileKnobDraft(profile));
							setRevision(profile.revision);
							setNotice("");
							setReviewed(false);
							setPreviewed(false);
						}}
					>
						Cancel
					</button>
				</Row>
			</fieldset>
		</Group>
	);
}
