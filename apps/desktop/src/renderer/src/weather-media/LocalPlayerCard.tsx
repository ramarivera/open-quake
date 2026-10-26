import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	LocalPlayerSnapshot,
	LocalPlayerTarget,
	MediaSnapshot,
} from "../../../shared/weather-media-contracts";
import type { StripTileProps } from "../strip/tileRegistry";
import { useWeatherLocale, useWeatherMedia } from "./hooks";
import { PlayerCard } from "./PlayerCard";

const empty: LocalPlayerSnapshot = {
	revision: 0,
	state: "unconfigured",
	title: "",
	trackIndex: 0,
	total: 0,
	positionMs: 0,
	errorCode: null,
};
export function LocalPlayerCard({
	tile,
	context,
}: StripTileProps): React.JSX.Element {
	const { client } = useWeatherMedia();
	const [state, setState] = useState(empty);
	const [busy, setBusy] = useState(false);
	const pending = useRef(false);
	const generation = useRef(0);
	const locale = useWeatherLocale();
	const deviceId = context.keyTarget?.deviceId;
	const profileId = context.keyTarget?.profileId;
	const pageId = context.keyTarget?.pageId;
	const revision = context.keyTarget?.revision;
	const keyCode = tile.keyCode;
	const target = useMemo(
		() =>
			deviceId !== undefined &&
			profileId !== undefined &&
			pageId !== undefined &&
			revision !== undefined
				? { deviceId, profileId, pageId, revision, keyCode }
				: undefined,
		[deviceId, profileId, pageId, revision, keyCode],
	);
	const targetId = JSON.stringify(target);
	const current = useRef(targetId);
	current.current = targetId;
	const refresh = useCallback(
		async (selected: LocalPlayerTarget, identity: string) => {
			if (current.current !== identity) return;
			const token = ++generation.current;
			const reply = await client.request({
				_tag: "localPlayer",
				target: selected,
			});
			if (
				current.current === identity &&
				generation.current === token &&
				reply?._tag === "localPlayer"
			)
				setState((previous) =>
					reply.snapshot.revision >= previous.revision
						? reply.snapshot
						: previous,
				);
		},
		[client],
	);
	useEffect(() => {
		setState(empty);
		if (!target) return;
		const selected = target;
		let disposed = false,
			reading = false;
		const read = async () => {
			if (disposed || reading) return;
			reading = true;
			try {
				await refresh(selected, targetId);
			} finally {
				reading = false;
			}
		};
		void read();
		const timer = setInterval(() => void read(), 1000);
		return () => {
			disposed = true;
			generation.current++;
			clearInterval(timer);
		};
	}, [targetId, target, refresh]);
	const control = async (intent: "previous" | "toggle" | "next" | "stop") => {
		if (pending.current || context.interactive === false || !target)
			return false;
		pending.current = true;
		setBusy(true);
		try {
			const result = await window.quakeKeyLibrary.request({
				type: "player-control",
				...target,
				intent,
			});
			await refresh(target, targetId);
			return result._tag === "success";
		} finally {
			pending.current = false;
			setBusy(false);
		}
	};
	const configured = state.state !== "unconfigured";
	const playing = state.state === "playing";
	const navigation = playing && state.total > 1;
	const media: MediaSnapshot = {
		revision: state.revision,
		error: null,
		session: configured
			? {
					id: `local:${targetId}:${state.trackIndex}`,
					appId: "open-quake.local",
					appName: "Local Music",
					title: state.title,
					artist: configured ? `${state.trackIndex + 1} / ${state.total}` : "",
					coverUrl: null,
					playing,
					durationMs: null,
					positionMs: state.positionMs,
					canPlay: configured,
					canPause: playing,
					canPrevious: navigation,
					canNext: navigation,
				}
			: null,
	};
	const message = !configured
		? locale === "de"
			? "Nicht konfiguriert"
			: "Not configured"
		: state.state === "failed"
			? locale === "de"
				? "Wiedergabe fehlgeschlagen"
				: "Playback failed"
			: "";
	return (
		<PlayerCard
			widthPx={tile.box.width}
			heightPx={tile.box.height}
			snapshot={media}
			control={control}
			locale={locale}
			source="local"
			statusText={message}
			pending={
				busy ||
				context.interactive === false ||
				!target ||
				state.state === "loading" ||
				state.state === "failed"
			}
			stop={() => void control("stop")}
		/>
	);
}
