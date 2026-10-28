import { Schema } from "effect";
import { useEffect, useState } from "react";
import { ProfileJson } from "../../../../../../packages/device/src/profiles/profile-contracts";

/** Preserve the action's value type, including legacy blank numeric flags. */
export function ActionValueInput({
	id,
	action,
	onChange,
}: {
	readonly id: string;
	readonly action: { readonly type: string; readonly value: ProfileJson };
	readonly onChange: (value: ProfileJson) => void;
}): React.JSX.Element {
	const encoded = JSON.stringify(action.value);
	const [source, setSource] = useState(encoded);
	const [invalid, setInvalid] = useState(false);
	useEffect(() => {
		setSource(encoded);
		setInvalid(false);
	}, [encoded]);
	if (typeof action.value === "boolean")
		return (
			<input
				id={id}
				type="checkbox"
				checked={action.value}
				onChange={(event) => onChange(event.target.checked)}
			/>
		);
	if (action.value === null || typeof action.value === "object")
		return (
			<>
				<textarea
					id={id}
					value={source}
					aria-invalid={invalid}
					aria-describedby={invalid ? `${id}-error` : undefined}
					onChange={(event) => {
						setSource(event.target.value);
						const result = Schema.decodeUnknownEither(
							Schema.parseJson(ProfileJson),
						)(event.target.value);
						setInvalid(result._tag === "Left");
						if (result._tag === "Right") onChange(result.right);
					}}
				/>
				{invalid && (
					<span id={`${id}-error`} role="status">
						Enter a valid JSON value.
					</span>
				)}
			</>
		);
	const numeric =
		typeof action.value === "number" ||
		["time", "page", "force"].includes(action.type);
	return (
		<input
			id={id}
			type={numeric ? "number" : "text"}
			value={action.value}
			onChange={(event) => {
				const value = event.target.value;
				if (!numeric) onChange(value);
				else if (value === "" && action.type === "force") onChange("");
				else if (value !== "" && Number.isFinite(event.target.valueAsNumber))
					onChange(event.target.valueAsNumber);
			}}
		/>
	);
}
