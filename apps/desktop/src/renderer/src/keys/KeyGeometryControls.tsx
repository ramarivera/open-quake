import {
	keyEditable,
	keyText,
} from "../../../../../../packages/device/src/profiles/key-editing-invariants.js";
import type { KeyGeometry } from "../../../../../../packages/device/src/profiles/key-geometry.js";
import type { ProfileKey } from "../../../../../../packages/device/src/profiles/profile-contracts.js";
import {
	effectiveSpan,
	FORCED_TILE_SPANS,
} from "../../../../../../packages/device/src/profiles/profile-footprint.js";
import type { ProfileLocale } from "../../../../../../packages/device/src/profiles/profile-manager-contracts.js";
import { Row } from "../ui/Form";

export function KeyGeometryControls({
	keyValue,
	geometry,
	locale,
	onChange,
}: {
	readonly keyValue: ProfileKey;
	readonly geometry: KeyGeometry;
	readonly locale: ProfileLocale;
	readonly onChange: (key: ProfileKey, geometry: KeyGeometry) => void;
}): React.JSX.Element {
	const de = locale === "de";
	const forced = FORCED_TILE_SPANS.has(keyValue.config.type);
	const size = effectiveSpan(keyValue.config.type, keyValue.config.size);
	return (
		<>
			<Row
				label={de ? "Verschieben / Tauschen" : "Move / swap"}
				htmlFor="key-destination"
			>
				<select
					id="key-destination"
					value={geometry.destination ?? keyValue.keyCode}
					disabled={!keyValue.config.type}
					onChange={(event) =>
						onChange(keyValue, { destination: event.target.value })
					}
				>
					{Array.from(
						{ length: 16 },
						(_, index) => `${Math.floor(index / 8) + 1},${(index % 8) + 1}`,
					).map((code) => (
						<option key={code} value={code}>
							{keyText("editor.destination", locale)
								.replace("{row}", code.split(",")[0] ?? "")
								.replace("{column}", code.split(",")[1] ?? "")}
						</option>
					))}
				</select>
				<small>
					{de
						? "Belegte Felder werden getauscht, sofern das Ziel nicht strukturell geschützt ist. Speichern zum Anwenden."
						: "Occupied cells swap unless the target has structural protection. Save to apply."}
				</small>
			</Row>
			<Row
				label={
					keyText("gridSize", locale) === "gridSize"
						? de
							? "Rastergröße"
							: "Grid Size"
						: keyText("gridSize", locale)
				}
				htmlFor="key-span"
			>
				<select
					id="key-span"
					value={`${size[0]},${size[1]}`}
					disabled={
						!keyValue.config.type || forced || !keyEditable(keyValue, "grid")
					}
					onChange={(event) => {
						const [width, height] = event.target.value.split(",").map(Number);
						if (width && height)
							onChange(
								{
									...keyValue,
									config: { ...keyValue.config, size: [width, height] },
								},
								{ ...geometry, replaceOverlaps: false },
							);
					}}
				>
					{Array.from(
						{ length: 16 },
						(_, index) => [(index % 8) + 1, Math.floor(index / 8) + 1] as const,
					).map(([w, h]) => (
						<option key={`${w},${h}`} value={`${w},${h}`}>
							{keyText(`shortcutGrid.sizeLabel.${w}x${h}`, locale).startsWith(
								"shortcutGrid.",
							)
								? keyText("shortcutGrid.sizeLabel.custom", locale)
										.replace("{width}", String(w))
										.replace("{height}", String(h))
								: keyText(`shortcutGrid.sizeLabel.${w}x${h}`, locale)}
						</option>
					))}
				</select>
				{forced && (
					<small>
						{de
							? "Feste Größe für diese Funktion."
							: "This function has a fixed size."}
					</small>
				)}
			</Row>
		</>
	);
}
