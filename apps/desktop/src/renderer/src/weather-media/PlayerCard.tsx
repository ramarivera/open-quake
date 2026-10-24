import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { canControlMedia } from "../../../shared/media-invariants";
import type {
	MediaIntent,
	MediaSnapshot,
	WeatherLocale,
} from "../../../shared/weather-media-contracts";
import { WEATHER_MEDIA_STRINGS } from "../../../shared/weather-media-strings";
import { useReducedMotion } from "../strip/tiles/clock/clockHooks";
import { MediaGuide } from "./guide";
import { TransportButton, TransportGlyph } from "./TransportButton";
import "./weather-media.css";

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
export const needleAngle = (snapshot: MediaSnapshot): number => {
	const session = snapshot.session;
	return !session?.playing
		? 25
		: 12 -
				27 *
					(session.durationMs
						? Math.min(1, Math.max(0, session.positionMs / session.durationMs))
						: 0);
};

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
	const id = useId().replace(/:/g, "");
	const session = snapshot.session;
	const [broken, setBroken] = useState(false);
	const [lightCover, setLightCover] = useState(false);
	const [guideVisible, setGuideVisible] = useState(false);
	const [guideMounted, setGuideMounted] = useState(false);
	const [failed, setFailed] = useState(false);
	const [title, setTitle] = useState(session?.title || "MUSIC PLAYER");
	const guide = useRef<MediaGuide | null>(null);
	const previousTrack = useRef(session?.id);
	const changedTrack = previousTrack.current !== session?.id;
	const osReduced = useReducedMotion();
	const reduced = reducedMotion ?? osReduced;
	const cover = session?.coverUrl;
	const trackTitle = session?.title || "MUSIC PLAYER";
	const hasSession = !!session;
	const available = !snapshot.error;
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
		previousTrack.current = session?.id;
	}, [session?.id]);
	useEffect(() => {
		void cover;
		setBroken(false);
		setLightCover(false);
	}, [cover]);
	useEffect(() => {
		const canvas = document.createElement("canvas");
		const context = canvas.getContext("2d");
		if (!context) {
			setTitle(trackTitle);
			return;
		}
		context.font = "300 20px Inter, Arial, sans-serif";
		const width = (text: string) =>
			context.measureText(text).width + Math.max(0, text.length - 1) * 10;
		let low = 0;
		let high = Array.from(trackTitle).length;
		const characters = Array.from(trackTitle);
		while (low < high) {
			const middle = Math.ceil((low + high) / 2);
			if (width(`${characters.slice(0, middle).join("")}...`) <= 427)
				low = middle;
			else high = middle - 1;
		}
		setTitle(
			width(trackTitle) <= 427
				? trackTitle
				: `${characters.slice(0, low).join("")}...`,
		);
	}, [trackTitle]);
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
			style={{ width: widthPx, height: heightPx }}
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
				<div className="oq-player-deck" />
				<div className="oq-player-ambient" />
				<div className="oq-player-platter" data-playing={playing}>
					<div className="oq-player-grooves" />
					<svg
						viewBox="0 0 415 416"
						className="oq-player-disc"
						aria-label={trackTitle}
						role="img"
					>
						<title>{trackTitle}</title>
						<defs>
							<clipPath id={`${id}-cover`}>
								<circle cx="207.5" cy="208" r="204" />
							</clipPath>
							<path
								id={`${id}-top`}
								d="M50.054 165.812 A163 163 0 0 1 364.946 165.812"
							/>
							<path
								id={`${id}-bottom`}
								d="M364.946 250.188 A163 163 0 0 1 50.054 250.188"
							/>
						</defs>
						<ellipse cx="207.5" cy="208" rx="204" ry="204.5" fill="#9c0402" />
						{cover && !broken ? (
							<image
								href={cover}
								x="3"
								y="3"
								width="409"
								height="410"
								preserveAspectRatio="xMidYMid slice"
								clipPath={`url(#${id}-cover)`}
							/>
						) : null}
						<text fill={lightCover ? "#1c1c1e" : "white"} textAnchor="middle">
							<textPath href={`#${id}-top`} startOffset="50%">
								{title}
							</textPath>
						</text>
						<text fill={lightCover ? "#1c1c1e" : "white"} textAnchor="middle">
							<textPath href={`#${id}-bottom`} startOffset="50%">
								{title}
							</textPath>
						</text>
						<circle cx="207.5" cy="208" r="48" fill="#080809" />
						<circle cx="207.5" cy="208" r="7" fill="#83838a" />
					</svg>
				</div>
				{cover && !broken ? (
					<img
						className="oq-player-cover-probe"
						src={cover}
						alt=""
						onError={() => setBroken(true)}
						onLoad={(event) => {
							const image = event.currentTarget;
							const canvas = document.createElement("canvas");
							canvas.width = 8;
							canvas.height = 8;
							const context = canvas.getContext("2d");
							if (!context) return;
							context.drawImage(image, 0, 0, 8, 8);
							const pixels = context.getImageData(0, 0, 8, 8).data;
							let sum = 0;
							for (let i = 0; i < pixels.length; i += 4)
								sum +=
									((pixels[i] ?? 0) * 0.2126 +
										(pixels[i + 1] ?? 0) * 0.7152 +
										(pixels[i + 2] ?? 0) * 0.0722) /
									255;
							setLightCover(sum / 64 > 0.45);
						}}
					/>
				) : null}
				<svg
					className="oq-player-arm"
					viewBox="0 0 1920 480"
					aria-hidden="true"
				>
					<g
						className={
							!session?.durationMs && playing ? "oq-player-unknown-sweep" : ""
						}
						style={{
							transform: `rotate(${needleAngle(snapshot)}deg)`,
							transitionDuration: changedTrack ? "900ms" : "1600ms",
						}}
					>
						<path
							d="M1270 803 1115 435 1010 174"
							fill="none"
							stroke="#111112"
							strokeWidth="32"
						/>
						<path
							d="M1270 803 1115 435 1010 174"
							fill="none"
							stroke="#a3a39a"
							strokeWidth="20"
						/>
						<path
							d="M1270 803 1115 435 1010 174"
							fill="none"
							stroke="#e2e2d4"
							strokeWidth="4"
						/>
						<rect
							x="984"
							y="139"
							width="52"
							height="85"
							rx="9"
							fill="#252526"
							stroke="#8f9087"
							strokeWidth="3"
						/>
						<path d="M1006 139v-17" stroke="#00ffff" strokeWidth="4" />
					</g>
				</svg>
				<div
					className="oq-player-source"
					data-active={!!session}
					title={session?.appId}
				>
					♪ <span>{session?.appName || "System Media"}</span>
				</div>
				{snapshot.error || failed ? (
					<div className="oq-player-error" role="status">
						{failed
							? strings.media.transport
							: mediaErrorText(snapshot, locale)}
					</div>
				) : null}
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
					<TransportGlyph kind={playing ? "stop" : "play"} />
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
				<div className="oq-player-volume-slot" data-volume-overlay-slot="">
					{volumeOverlay}
				</div>
				{guideMounted ? (
					<div
						className="oq-player-guide"
						data-visible={guideVisible}
						role="status"
					>
						<div aria-hidden="true">♪</div>
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
