import { Option } from "effect";
import {
	DEFAULT_KEY_TITLE_STYLE,
	editKeyTitleStyle,
	keyText,
} from "../../../../../../packages/device/src/profiles/key-editing-invariants.js";
import type {
	ProfileKey,
	ProfileTitle,
} from "../../../../../../packages/device/src/profiles/profile-contracts.js";
import type { ProfileLocale } from "../../../../../../packages/device/src/profiles/profile-manager-contracts.js";
import { Row } from "../ui/Form";

export function KeyTitleSettings({
	keyValue,
	alternate,
	locale,
	onChange,
}: {
	keyValue: ProfileKey;
	alternate: boolean;
	locale: ProfileLocale;
	onChange: (key: ProfileKey) => void;
}): React.JSX.Element {
	const title = alternate
		? Option.getOrElse(keyValue.config.alterTitle, () => keyValue.config.title)
		: keyValue.config.title;
	const change = (patch: Partial<ProfileTitle>): void =>
		onChange(editKeyTitleStyle(keyValue, { ...title, ...patch }, alternate));
	return (
		<details className="key-title-settings">
			<summary>{keyText("editor.titleStyle", locale)}</summary>
			<fieldset>
				<Row label={keyText("showHeading", locale)} htmlFor="key-title-display">
					<input
						id="key-title-display"
						type="checkbox"
						checked={title.display}
						onChange={(e) => change({ display: e.target.checked })}
					/>
				</Row>
				<Row label="Position" htmlFor="key-title-position">
					<select
						id="key-title-position"
						value={title.pos}
						onChange={(e) =>
							change({
								pos:
									e.target.value === "mid"
										? "mid"
										: e.target.value === "top"
											? "top"
											: "bot",
							})
						}
					>
						<option value="bot">{keyText("alignBottom", locale)}</option>
						<option value="mid">{keyText("alignCenter", locale)}</option>
						<option value="top">{keyText("alignTop", locale)}</option>
					</select>
				</Row>
				<Row label={keyText("fontSize", locale)} htmlFor="key-title-size">
					<input
						id="key-title-size"
						type="number"
						min={6}
						max={18}
						value={title.size}
						onChange={(e) => {
							const size = e.target.valueAsNumber;
							if (Number.isFinite(size))
								change({ size: Math.max(6, Math.min(18, size)) });
						}}
					/>
				</Row>
				<Row label="Style">
					{(["bold", "italic", "underline"] as const).map((token) => (
						<button
							key={token}
							type="button"
							aria-label={token}
							aria-pressed={title.style.split("|").includes(token)}
							onClick={() =>
								change({
									style: title.style.split("|").includes(token)
										? title.style
												.split("|")
												.filter((part) => part !== token)
												.join("|")
										: [...title.style.split("|").filter(Boolean), token].join(
												"|",
											),
								})
							}
						>
							{token === "bold" ? "B" : token === "italic" ? "I" : "U"}
						</button>
					))}
				</Row>
				<Row label="Color" htmlFor="key-title-color">
					<input
						id="key-title-color"
						type="color"
						value={title.color.slice(0, 7)}
						onChange={(e) => change({ color: e.target.value })}
					/>
					<button
						type="button"
						id="key-title-reset"
						onClick={() => change(DEFAULT_KEY_TITLE_STYLE)}
					>
						{keyText("resetDefault", locale)}
					</button>
				</Row>
			</fieldset>
		</details>
	);
}
