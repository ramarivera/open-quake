import { Either, Option, Schema } from "effect";
import { useEffect } from "react";
import {
	duration,
	formatTimer,
	MeetingAction,
} from "../../../../../shared/meeting-bridge";
import {
	meetingRequest,
	useMeetingNow,
	useMeetings,
} from "../../../meetings/useMeetings";
import type { StripTileProps } from "../../tileRegistry";
import { GenericTile } from "../GenericTile";
import { MeetingGlyph } from "./MeetingGlyph";
import "./meeting.css";

export function MeetingKey({
	tile,
	context,
}: StripTileProps): React.JSX.Element {
	const { snapshot } = useMeetings();
	const now = useMeetingNow();
	const mic = context.hardware?.available ? context.hardware.mic : undefined;
	useEffect(() => {
		if (tile.type !== "mic") return;
		const timer = setInterval(() => {
			void meetingRequest({ _tag: "read" });
		}, 1000);
		return () => clearInterval(timer);
	}, [tile.type]);
	if (tile.type === "mic" && tile.cellTheme !== "meetingAssistantTheme")
		return <GenericTile tile={tile} context={context} />;
	const action = Schema.decodeUnknownEither(MeetingAction)(tile.type);
	if (Either.isLeft(action))
		return <GenericTile tile={tile} context={context} />;
	const main = snapshot?.records.find((r) => Option.isNone(r.parentId));
	const side = snapshot?.records.find((r) => Option.isSome(r.parentId));
	const recording = main?.state === "recording";
	const lastMark = main?.marks.at(-1);
	const active =
		tile.type === "meetingMinutes"
			? recording
			: tile.type === "tempMeetingMinutes"
				? side?.state === "recording"
				: tile.type === "meetingRecordMark"
					? recording && !!lastMark && Option.isNone(lastMark.endMs)
					: tile.type === "liveAudioTranslate"
						? snapshot?.translating
						: mic;
	const remaining = Math.max(0, (snapshot?.cooldowns[tile.type] ?? 0) - now);
	const sweep = 360 * (1 - remaining / 5000);
	const start = tile.type === "meetingMinutes";
	const kind =
		tile.type === "meetingRecordMark"
			? "mark"
			: tile.type === "liveAudioTranslate"
				? "translate"
				: tile.type === "tempMeetingMinutes"
					? "record"
					: tile.type === "mic" && mic === false
						? "mute"
						: "mic";
	const title =
		tile.key.config.title.text ||
		(start
			? "Start"
			: tile.type === "mic"
				? "Mic mute"
				: kind === "mark"
					? "Mark"
					: kind === "record"
						? "Record"
						: "Translate");
	return (
		<button
			type="button"
			className={`meeting-key${start ? " meeting-start" : ""}`}
			data-active={!!active}
			data-meeting-action={tile.type}
			aria-label={title}
			aria-pressed={!!active}
			aria-disabled={
				remaining > 0 || (tile.type === "mic" && mic === undefined)
			}
			disabled={
				tile.type === "mic" &&
				(mic === undefined || context.interactive === false)
			}
			onClick={() => {
				if (tile.type === "mic") {
					const target = context.keyTarget;
					if (target)
						void window.quakeKeyLibrary
							?.request({
								...target,
								type: "activate",
								keyCode: tile.keyCode,
								kind: "press",
							})
							.finally(() =>
								window.quakeKeyLibrary?.request({
									...target,
									type: "activate",
									keyCode: tile.keyCode,
									kind: "release",
								}),
							);
					return;
				}
				void meetingRequest({
					_tag: "action",
					action: action.right,
					keyCode: tile.keyCode,
				});
			}}
		>
			<span className="meeting-key-title">{title}</span>
			{start ? (
				<>
					<span className="meeting-key-timer">
						{recording && main ? formatTimer(duration(main, now)) : "00:00:00"}
					</span>
					<span className="meeting-key-status">
						{recording
							? "Recording"
							: main?.state === "processing"
								? "Processing"
								: ""}
					</span>
				</>
			) : null}
			<span className="meeting-key-glyph">
				<MeetingGlyph kind={kind} />
			</span>
			{kind === "mark" && main?.marks.length ? (
				<span className="meeting-mark-count" data-open={!!active}>
					{main.marks.length}
				</span>
			) : null}
			{remaining > 0 ? (
				<span
					className="meeting-cooldown"
					style={{
						background: `conic-gradient(from 0deg, transparent 0deg ${sweep}deg, #0008 ${sweep}deg 360deg)`,
					}}
				/>
			) : null}
		</button>
	);
}
