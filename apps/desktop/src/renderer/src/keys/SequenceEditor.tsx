import { Option, Schema } from "effect";
import { useRef, useState } from "react";
import { MAX_SEQUENCE_OPERATIONS } from "../../../../../../packages/device/src/actions/action-contracts";
import {
	ACTION_REGISTRY,
	createActionDraft,
} from "../../../../../../packages/device/src/actions/action-registry";
import {
	isSequenceSelectable,
	SEQUENCE_LIBRARY,
} from "../../../../../../packages/device/src/actions/sequence-library";
import {
	ProfileJsonObject,
	type ProfileKey,
} from "../../../../../../packages/device/src/profiles/profile-contracts.js";

// Registry defaults and sequence membership don't depend on the row or draft.
// Reuse the immutable options so editing 100 rows doesn't rebuild Schema parsers.
const sequenceFunctionOptions = SEQUENCE_LIBRARY.flatMap((group) => [
	...group.ids,
]).map((type) => {
	const supported = isSequenceSelectable(type);
	return (
		<option key={type} disabled={!supported}>
			{type}
		</option>
	);
});

export const withSequenceIds = (key: ProfileKey): ProfileKey => ({
	...key,
	config: {
		...key.config,
		subActions: Option.map(key.config.subActions, (steps) =>
			steps.map((step) => ({
				...step,
				editorId:
					typeof step.editorId === "string"
						? step.editorId
						: crypto.randomUUID(),
			})),
		),
	},
});
const Step = Schema.Struct({
	config: Schema.Struct({
		type: Schema.String,
		actions: Schema.Array(
			Schema.Struct({
				type: Schema.String,
				value: Schema.Union(Schema.String, Schema.Number),
			}),
		),
		gap: Schema.optional(Schema.Number),
	}),
});
/** Preserve unknown imported fields when a supported editor field changes. */
export const changeSequenceStep = (
	step: typeof ProfileJsonObject.Type,
	patch: Partial<(typeof Step.Type)["config"]>,
): typeof ProfileJsonObject.Type => {
	const original =
		typeof step.config === "object" &&
		step.config !== null &&
		!Array.isArray(step.config)
			? step.config
			: {};
	return Schema.decodeUnknownSync(ProfileJsonObject)({
		...step,
		config: { ...original, ...patch },
	});
};
/** A Value edit changes only the first action's value, including retained imports. */
export const changeSequenceValue = (
	step: typeof ProfileJsonObject.Type,
	value: string,
): typeof ProfileJsonObject.Type => {
	const { config } = Schema.decodeUnknownSync(Step)(step, {
		onExcessProperty: "preserve",
	});
	const first = config.actions[0];
	return changeSequenceStep(step, {
		...config,
		actions: [
			{
				...first,
				type: first?.type ?? "key",
				value: config.type === "delay" ? Number(value) : value,
			},
			...config.actions.slice(1),
		],
	});
};
export function SequenceEditor({
	value,
	onChange,
}: {
	value: readonly (typeof ProfileJsonObject.Type)[];
	onChange: (value: readonly (typeof ProfileJsonObject.Type)[]) => void;
}): React.JSX.Element {
	const [expanded, setExpanded] = useState(true);
	const region = useRef<HTMLDivElement>(null);
	const change = (
		index: number,
		config: Partial<(typeof Step.Type)["config"]>,
	): void =>
		onChange(
			value.map((step, i) =>
				i === index ? changeSequenceStep(step, config) : step,
			),
		);
	return (
		<div className="key-sequence">
			<h3>Multiple Operations</h3>
			<p aria-live="polite">Contain: {value.length} Project</p>
			<button
				type="button"
				aria-expanded={expanded}
				onClick={() => setExpanded(!expanded)}
			>
				{expanded ? "Back" : "Edit operations"}
			</button>
			<div hidden={!expanded} ref={region}>
				{value.map((raw, index) => {
					const rowId =
						typeof raw.editorId === "string"
							? raw.editorId
							: JSON.stringify(raw);
					const decoded = Schema.decodeUnknownEither(Step)(raw);
					if (decoded._tag === "Left")
						return (
							<p key={rowId}>
								Unsupported operation{" "}
								<button
									type="button"
									onClick={() => onChange(value.filter((_, i) => i !== index))}
								>
									Delete
								</button>
							</p>
						);
					const config = decoded.right.config;
					return (
						<div className="key-sequence-step" key={rowId}>
							<label>
								Function{" "}
								<select
									value={config.type}
									onChange={(e) => {
										const type = e.target.value;
										const entry = ACTION_REGISTRY.find(
											(entry) => entry.id === type,
										);
										if (entry) {
											const draft = Schema.decodeUnknownSync(Step)({
												config: createActionDraft(entry.id),
											});
											change(index, draft.config);
											return;
										}
										change(index, {
											type,
											actions: [
												{
													type:
														type === "delay"
															? "time"
															: type === "website"
																? "url"
																: type === "hotkey"
																	? "key"
																	: type === "open"
																		? "path"
																		: "text",
													value: type === "delay" ? 1000 : "",
												},
											],
										});
									}}
								>
									{sequenceFunctionOptions}
								</select>
							</label>
							{!["buzzer", "mic"].includes(config.type) && (
								<label>
									{config.type === "delay"
										? "Milliseconds"
										: config.type === "homeAssistant"
											? "Home Assistant configuration (JSON)"
											: "Value"}
									<input
										type={config.type === "delay" ? "number" : "text"}
										value={config.actions[0]?.value ?? ""}
										onChange={(e) =>
											onChange(
												value.map((step, i) =>
													i === index
														? changeSequenceValue(step, e.target.value)
														: step,
												),
											)
										}
									/>
								</label>
							)}
							<label>
								Interval for executing next operation
								<input
									type="number"
									min={0}
									max={60000}
									value={config.gap ?? 100}
									onChange={(e) =>
										change(index, { gap: Number(e.target.value) })
									}
								/>
							</label>
							<button
								type="button"
								disabled={index === 0}
								aria-label={`Move operation ${index + 1} up`}
								onClick={() => {
									const next = [...value];
									const previous = next[index - 1];
									if (previous) {
										next[index - 1] = raw;
										next[index] = previous;
										onChange(next);
									}
								}}
							>
								↑
							</button>
							<button
								type="button"
								onClick={() => onChange(value.filter((_, i) => i !== index))}
							>
								Delete
							</button>
						</div>
					);
				})}
				<button
					type="button"
					disabled={value.length >= MAX_SEQUENCE_OPERATIONS}
					onClick={() => {
						onChange([
							...value,
							Schema.decodeUnknownSync(ProfileJsonObject)({
								editorId: crypto.randomUUID(),
								config: {
									type: "delay",
									actions: [{ type: "time", value: 1000 }],
								},
							}),
						]);
						queueMicrotask(() =>
							region.current
								?.querySelector<HTMLSelectElement>(
									".key-sequence-step:last-of-type select",
								)
								?.focus(),
						);
					}}
				>
					Add Operation
				</button>
			</div>
		</div>
	);
}
