import { Either, Schema } from "effect";
import { MeetingAction } from "../../../shared/meeting-bridge";
import type { StripLayout } from "../strip/geometry";
import type { StripKeyEvent } from "../strip/touch-controller";

/** Cancelled releases clear pressed state but never activate a recorder. */
export function meetingTouchAction(
	event: StripKeyEvent,
	layout: StripLayout | undefined,
): typeof MeetingAction.Type | undefined {
	if (event.keyAction !== 1 || !event.voiceTouchEnd) return;
	const tile = layout?.tiles.find((tile) => tile.keyCode === event.keyCode);
	if (
		!tile ||
		(tile.type === "mic" && tile.cellTheme !== "meetingAssistantTheme")
	)
		return;
	const action = Schema.decodeUnknownEither(MeetingAction)(tile.type);
	return Either.isRight(action) ? action.right : undefined;
}
