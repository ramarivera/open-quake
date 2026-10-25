import { Schema } from "effect";
import { HaKey } from "../../../../../../../../packages/edge/src/home-assistant/ha-contracts";
import { tileLines } from "../../../../../../../../packages/edge/src/home-assistant/ha-invariants";
import { useHaLive } from "../../../management/integrations/useHaLive";
import type { StripTileProps } from "../../tileRegistry";
import { GenericTile } from "../GenericTile";
export function HomeAssistantTile(props: StripTileProps): React.JSX.Element {
	const live = useHaLive();
	const action = props.tile.key.config.actions.find(
		(a) =>
			a.type === "configData" ||
			a.type === "haConfig" ||
			a.type === "homeAssistant",
	);
	let key: HaKey | undefined;
	try {
		const result = Schema.decodeUnknownEither(HaKey)(
			typeof action?.value === "string"
				? JSON.parse(action.value)
				: action?.value,
		);
		if (result._tag === "Right") key = result.right;
	} catch {
		key = undefined;
	}
	if (!key || key.custom_display_type === "icon")
		return <GenericTile {...props} />;
	const entity = live.states.find((e) => e.entity_id === key.entity_id);
	const lines = tileLines(key, entity, live.connected);
	return (
		<div
			className="strip-tile-layer"
			role="status"
			aria-label={lines.join(", ")}
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				gap: 4,
				padding: 16,
				color: "var(--strip-text)",
				fontWeight: 600,
				lineHeight: 1.2,
				fontSize: key.custom_display_settings.fontSize,
				textAlign: "center",
				overflow: "hidden",
			}}
		>
			{lines.map((line, index) => (
				<div key={key?.custom_display_detail[index]?.displayItemKey ?? "state"}>
					{line}
				</div>
			))}
		</div>
	);
}
