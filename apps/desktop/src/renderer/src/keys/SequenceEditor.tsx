import { Option, Schema } from "effect";
import {
	ProfileJsonObject,
	type ProfileKey,
} from "../../../../../../packages/device/src/profiles/profile-contracts.js";
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
export function SequenceEditor({
	value,
	onChange,
}: {
	value: readonly (typeof ProfileJsonObject.Type)[];
	onChange: (value: readonly (typeof ProfileJsonObject.Type)[]) => void;
}): React.JSX.Element {
	const change = (index: number, config: (typeof Step.Type)["config"]): void =>
		onChange(
			value.map((step, i) =>
				i === index
					? Schema.decodeUnknownSync(ProfileJsonObject)({ ...step, config })
					: step,
			),
		);
	return (
		<div className="key-sequence">
			<h3>Multiple Operations</h3>
			{value.map((raw, index) => {
				const rowId =
					typeof raw.editorId === "string" ? raw.editorId : JSON.stringify(raw);
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
								{["hotkey", "website", "text", "open", "delay"].map((type) => (
									<option key={type}>{type}</option>
								))}
							</select>
						</label>
						<label>
							{config.type === "delay" ? "Milliseconds" : "Value"}
							<input
								type={config.type === "delay" ? "number" : "text"}
								value={config.actions[0]?.value ?? ""}
								onChange={(e) =>
									change(index, {
										...config,
										actions: [
											{
												type: config.actions[0]?.type ?? "key",
												value:
													config.type === "delay"
														? Number(e.target.value)
														: e.target.value,
											},
										],
									})
								}
							/>
						</label>
						<label>
							Interval for executing next operation
							<input
								type="number"
								min={0}
								max={60000}
								value={config.gap ?? 100}
								onChange={(e) =>
									change(index, { ...config, gap: Number(e.target.value) })
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
				disabled={value.length >= 100}
				onClick={() =>
					onChange([
						...value,
						Schema.decodeUnknownSync(ProfileJsonObject)({
							editorId: crypto.randomUUID(),
							config: {
								type: "delay",
								actions: [{ type: "time", value: 1000 }],
							},
						}),
					])
				}
			>
				Add Operation
			</button>
		</div>
	);
}
