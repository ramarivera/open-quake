import { type ReactNode, useEffect, useRef, useState } from "react";
import { canControlMedia } from "../../../shared/media-invariants";
import type {
	MediaIntent,
	MediaSnapshot,
	WeatherLocale,
} from "../../../shared/weather-media-contracts";
import { WEATHER_MEDIA_STRINGS } from "../../../shared/weather-media-strings";
import { stripPaletteProperties } from "../strip/palette";
import { useReducedMotion } from "../strip/tiles/clock/clockHooks";
import { MediaGuide } from "./guide";
import { TransportButton, TransportGlyph } from "./TransportButton";
import "./weather-media.css";

const palette = stripPaletteProperties();

export function mediaErrorText(
	snapshot: MediaSnapshot,
	locale: WeatherLocale,
): string {
	const strings = WEATHER_MEDIA_STRINGS[locale].media;
	switch (snapshot.error) {
		case null:
			return "";
		case "TCC_DENIED":
			return strings.tccDenied;
		case "MEDIAREMOTE_UNAVAILABLE":
			return strings.generic;
		case "TRANSPORT_ERROR":
			return strings.transport;
		case "SESSION_LOST":
			return strings.sessionLost;
		default:
			return strings.generic;
	}
}
/** Played fraction of a known duration, else undefined. */
export const playbackFraction = (
	snapshot: MediaSnapshot,
	positionMs = snapshot.session?.positionMs ?? 0,
): number | undefined => {
	const duration = snapshot.session?.durationMs;
	return duration ? Math.min(1, Math.max(0, positionMs / duration)) : undefined;
};

export const formatPlaybackTime = (ms: number): string => {
	const total = Math.floor(Math.max(0, ms) / 1000);
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = String(total % 60).padStart(2, "0");
	return hours
		? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
		: `${minutes}:${seconds}`;
};

/** The session position, advanced locally while playing between snapshots. */
function usePlaybackPosition(snapshot: MediaSnapshot): number {
	const session = snapshot.session;
	const [now, setNow] = useState(() => Date.now());
	const [anchor, setAnchor] = useState(() => Date.now());
	useEffect(() => {
		void snapshot.revision;
		void session?.positionMs;
		setAnchor(Date.now());
		setNow(Date.now());
	}, [snapshot.revision, session?.positionMs]);
	useEffect(() => {
		if (!session?.playing) return;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [session?.playing]);
	if (!session) return 0;
	const advanced = session.playing
		? session.positionMs + Math.max(0, now - anchor)
		: session.positionMs;
	return session.durationMs ? Math.min(session.durationMs, advanced) : advanced;
}

/** 380×88 at 1471,355 is reserved for PR #24's volume owner. */
export interface PlayerCardProps {
	widthPx: number;
	heightPx: number;
	snapshot: MediaSnapshot;
	control: (intent: MediaIntent) => Promise<boolean>;
	locale?: WeatherLocale;
	volumeOverlay?: ReactNode;
	reducedMotion?: boolean;
}

export function PlayerCard({
	widthPx,
	heightPx,
	snapshot,
	control,
	locale = "en",
	volumeOverlay,
	reducedMotion,
}: PlayerCardProps): React.JSX.Element {
	const session = snapshot.session;
	const [broken, setBroken] = useState(false);
	const [guideVisible, setGuideVisible] = useState(false);
	const [guideMounted, setGuideMounted] = useState(false);
	const [failed, setFailed] = useState(false);
	const guide = useRef<MediaGuide | null>(null);
	const osReduced = useReducedMotion();
	const reduced = reducedMotion ?? osReduced;
	const cover = session?.coverUrl;
	const hasSession = !!session;
	const available = !snapshot.error;
	const position = usePlaybackPosition(snapshot);
	const fraction = playbackFraction(snapshot, position);
	useEffect(() => {
		if (guideVisible) {
			setGuideMounted(true);
			return;
		}
		const timer = setTimeout(() => setGuideMounted(false), 500);
		return () => clearTimeout(timer);
	}, [guideVisible]);
	useEffect(() => {
		guide.current = new MediaGuide(setGuideVisible);
		return () => {
			guide.current?.dispose();
			guide.current = null;
		};
	}, []);
	useEffect(() => {
		guide.current?.update(hasSession, available);
	}, [hasSession, available]);
	useEffect(() => {
		void cover;
		setBroken(false);
	}, [cover]);
	useEffect(() => {
		if (!failed) return;
		const timer = setTimeout(() => setFailed(false), 1800);
		return () => clearTimeout(timer);
	}, [failed]);
	const send = (intent: MediaIntent) => {
		if (!session && !snapshot.error) {
			guide.current?.show(true);
			return;
		}
		void control(intent).then((accepted) => {
			if (!accepted) setFailed(true);
		});
	};
	const strings = WEATHER_MEDIA_STRINGS[locale];
	const playing = !!session?.playing;
	return (
		<div
			className="oq-player"
			style={{ ...palette, width: widthPx, height: heightPx }}
			data-state={
				snapshot.error
					? "unavailable"
					: !session
						? "idle"
						: playing
							? "playing"
							: "paused"
			}
			data-motion={reduced ? "reduce" : "full"}
			data-testid="dk-player"
		>
			<div
				className="oq-player-stage"
				style={{ transform: `scale(${widthPx / 1920},${heightPx / 480})` }}
			>
				<div className="oq-player-cover">
					{cover && !broken ? (
						<img src={cover} alt="" onError={() => setBroken(true)} />
					) : (
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<path d="M9 18V5l11-2v13" />
							<circle cx="6" cy="18" r="3" />
							<circle cx="17" cy="16" r="3" />
						</svg>
					)}
				</div>
				<div className="oq-player-info">
					{snapshot.error || failed ? (
						<div className="oq-player-error" role="status">
							{failed
								? strings.media.transport
								: mediaErrorText(snapshot, locale)}
						</div>
					) : null}
					<div
						className="oq-player-source"
						data-active={!!session}
						title={session?.appId}
					>
						<span>{session?.appName || "System Media"}</span>
					</div>
					<div className="oq-player-title" title={session?.title}>
						{session?.title || "—"}
					</div>
					<div className="oq-player-artist" title={session?.artist}>
						{session?.artist || "\u00a0"}
					</div>
					{session ? (
						<div className="oq-player-progress">
							<span>{formatPlaybackTime(position)}</span>
							{fraction !== undefined ? (
								<div
									className="oq-player-track"
									role="progressbar"
									aria-valuemin={0}
									aria-valuemax={100}
									aria-valuenow={Math.round(fraction * 100)}
								>
									<i style={{ width: `${fraction * 100}%` }} />
								</div>
							) : (
								<div className="oq-player-track" data-unknown="true" />
							)}
							<span>
								{session.durationMs
									? formatPlaybackTime(session.durationMs)
									: "--:--"}
							</span>
						</div>
					) : null}
				</div>
				<div className="oq-player-controls">
					<TransportButton
						className="oq-player-previous"
						id="audioPlayerViewBackwards"
						label={strings.clock.musicPrev}
						disabled={!available || !session?.canPrevious}
						onPress={() => send("previous")}
					>
						<TransportGlyph kind="previous" />
					</TransportButton>
					<TransportButton
						className="oq-player-main"
						id={playing ? "playStopActive" : "playStop"}
						label={strings.clock.musicPlayPause}
						disabled={
							!available || (!!session && !canControlMedia(snapshot, "toggle"))
						}
						onPress={() => send("toggle")}
					>
						<TransportGlyph kind={playing ? "pause" : "play"} />
					</TransportButton>
					<TransportButton
						className="oq-player-next"
						id="audioPlayerViewForwards"
						label={strings.clock.musicNext}
						disabled={!available || !session?.canNext}
						onPress={() => send("next")}
					>
						<TransportGlyph kind="next" />
					</TransportButton>
				</div>
				<div className="oq-player-volume-slot" data-volume-overlay-slot="">
					{volumeOverlay}
				</div>
				{guideMounted ? (
					<div
						className="oq-player-guide"
						data-visible={guideVisible}
						role="status"
					>
						<section>
							<strong>{strings.media.noSessionGuideTitle}</strong>
							<span>{strings.media.noSessionGuideSubtitle}</span>
						</section>
					</div>
				) : null}
			</div>
		</div>
	);
}
