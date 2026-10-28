import { Schema } from "effect";
import { useEffect, useRef, useState } from "react";
import { ProfileJson } from "../../../../../../packages/device/src/profiles/profile-contracts";

/** Preserve the action's value type, including legacy blank numeric flags. */
export function ActionValueInput({
	id,
	action,
	onChange,
	onValidityChange,
}: {
	readonly id: string;
	readonly action: { readonly type: string; readonly value: ProfileJson };
	readonly onChange: (value: ProfileJson) => void;
	/** Reports invalid drafts so the editor can refuse to save the stale value. */
	readonly onValidityChange?: (valid: boolean) => void;
}): React.JSX.Element {
	const numeric =
		typeof action.value === "number" ||
		["time", "page", "force"].includes(action.type);
	const encoded = numeric ? String(action.value) : JSON.stringify(action.value);
	const [source, setSource] = useState(encoded);
	const [invalid, setInvalid] = useState(false);
	const validity = useRef(onValidityChange);
	validity.current = onValidityChange;
	useEffect(() => {
		setSource(encoded);
		setInvalid(false);
	}, [encoded]);
	useEffect(() => {
		validity.current?.(!invalid);
	}, [invalid]);
	useEffect(() => () => validity.current?.(true), []);
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
	return (
		<>
			<input
				id={id}
				type={numeric ? "number" : "text"}
				value={numeric ? source : action.value}
				aria-invalid={invalid}
				aria-describedby={invalid ? `${id}-error` : undefined}
				onChange={(event) => {
					const value = event.target.value;
					if (!numeric) onChange(value);
					else {
						setSource(value);
						const blankForce = value === "" && action.type === "force";
						const valid =
							blankForce ||
							(value !== "" && Number.isFinite(event.target.valueAsNumber));
						setInvalid(!valid);
						if (valid) onChange(blankForce ? "" : event.target.valueAsNumber);
					}
				}}
			/>
			{invalid && (
				<span id={`${id}-error`} role="status">
					Enter a valid number.
				</span>
			)}
		</>
	);
}
