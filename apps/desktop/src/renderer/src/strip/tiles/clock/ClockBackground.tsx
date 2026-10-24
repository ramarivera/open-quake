import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { themeArtUrl } from "./art";
import {
	BackgroundLoader,
	type BackgroundRequest,
	type EffectiveBackground,
	initialBackground,
} from "./backgroundLoader";

function requestKey(request: BackgroundRequest): string {
	return request.kind === "none"
		? "none"
		: `${request.themeId}|${request.media?.kind ?? "builtin"}|${request.media?.url ?? ""}`;
}

/** L0 media (built-in art, custom image or video) and the L1 scrim. */
export function ClockBackground({
	request,
}: {
	request: BackgroundRequest;
}): React.JSX.Element {
	const [state, setState] = useState<EffectiveBackground>(() =>
		initialBackground(request),
	);
	const loader = useRef<BackgroundLoader | null>(null);
	const video = useRef<HTMLVideoElement>(null);
	const latest = useRef(request);
	latest.current = request;
	const key = requestKey(request);
	// Layout effects run before any media event can be dispatched, so the
	// first load/error/playing always carries the applied generation.
	useLayoutEffect(() => {
		const instance = new BackgroundLoader(setState);
		loader.current = instance;
		return () => {
			instance.dispose();
			loader.current = null;
		};
	}, []);
	useLayoutEffect(() => {
		void key;
		loader.current?.apply(latest.current);
	}, [key]);
	// Video pauses while the strip window is hidden (BR-04).
	useEffect(() => {
		const onVisibility = (): void => {
			const element = video.current;
			if (!element) return;
			if (document.hidden) element.pause();
			else if (element.paused) void element.play().catch(() => {});
		};
		document.addEventListener("visibilitychange", onVisibility);
		return () => document.removeEventListener("visibilitychange", onVisibility);
	}, []);
	const generation = state.generation;
	const ready = (): void => loader.current?.ready(generation);
	const failed = (): void => loader.current?.failed(generation);
	let media: React.JSX.Element | null = null;
	if (state.kind === "builtin")
		media = (
			<img
				className="oq-clock-bg-media"
				src={themeArtUrl(state.themeId)}
				alt=""
				data-source="builtin"
				data-theme={state.themeId}
			/>
		);
	else if (state.kind === "image")
		media = (
			<img
				key={state.url}
				className="oq-clock-bg-media"
				src={state.url}
				alt=""
				data-source="custom"
				onLoad={ready}
				onError={failed}
			/>
		);
	else if (state.kind === "video")
		media = (
			<video
				key={state.url}
				ref={video}
				className="oq-clock-bg-media"
				src={state.url}
				data-source="custom"
				autoPlay
				muted
				loop
				playsInline
				preload="auto"
				onCanPlay={(event) => {
					const element = event.currentTarget;
					if (!document.hidden && element.paused)
						void element.play().catch(() => {});
				}}
				onPlaying={ready}
				onError={failed}
			/>
		);
	return (
		<div className="oq-clock-bg" data-background={state.kind}>
			{media}
			<div className="oq-clock-scrim" aria-hidden="true" />
		</div>
	);
}
