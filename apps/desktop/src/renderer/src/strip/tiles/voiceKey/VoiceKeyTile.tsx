import { Option } from "effect";
import { useId } from "react";
import {
	CancelIndicator,
	ClawbotDot,
} from "../../overlays/voice/KeyDecorations";
import { cancelIndicatorKey } from "../../overlays/voice/voice-state";
import type { StripTileProps } from "../../tileRegistry";
import { GenericTile } from "../GenericTile";

/**
 * aiChat and clawbot keys: DK's generic tile plus the AI cancel indicator,
 * which hides the icon, and the selected clawbot's green dot
 * (strip-voice-ui "AI key decorations").
 */
export function VoiceKeyTile(props: StripTileProps): React.JSX.Element {
	const id = useId().replace(/[^\w-]/g, "");
	const { view } = props.context.voice;
	const cancel = Option.contains(cancelIndicatorKey(view), props.tile.keyCode);
	const dot =
		props.tile.type === "clawbot" &&
		Option.contains(view.activeClawbot, props.tile.keyCode);
	return (
		<div className="strip-voice-key" data-cancel={cancel || undefined}>
			<GenericTile {...props} />
			{cancel ? <CancelIndicator id={id} /> : null}
			{dot ? <ClawbotDot /> : null}
		</div>
	);
}
