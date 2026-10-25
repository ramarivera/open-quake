import { useEffect, useRef } from "react";
import {
	type BarMotion,
	drawLevelMeter,
	initialBarMotion,
	stepBarMotion,
} from "./level-meter";

/** A canvas sized in strip pixels, backed at the window's pixel ratio. */
function useStripCanvas(width: number, height: number) {
	const ref = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		const canvas = ref.current;
		if (!canvas) return;
		const ratio = window.devicePixelRatio || 1;
		canvas.width = Math.max(1, Math.floor(width * ratio));
		canvas.height = Math.max(1, Math.floor(height * ratio));
	}, [width, height]);
	const context = (): CanvasRenderingContext2D | null => {
		const context = ref.current?.getContext("2d") ?? null;
		const ratio = window.devicePixelRatio || 1;
		context?.setTransform(ratio, 0, 0, ratio, 0, 0);
		return context;
	};
	return { ref, context };
}

/**
 * The level meter: one frame per animation frame, smoothing toward the latest
 * real level. Under reduced motion it redraws on each level instead, unsmoothed.
 */
export function LevelMeterCanvas({
	width,
	height,
	rms,
	speaking,
	motion,
}: {
	width: number;
	height: number;
	rms: number;
	speaking: boolean;
	motion: "full" | "reduce";
}): React.JSX.Element {
	const { ref, context } = useStripCanvas(width, height);
	const level = useRef({ rms, speaking });
	level.current = { rms, speaking };
	const state = useRef<BarMotion>(initialBarMotion);
	// biome-ignore lint/correctness/useExhaustiveDependencies: context reads the ref.
	useEffect(() => {
		if (motion === "reduce") return;
		let frame = 0;
		const loop = (): void => {
			state.current = stepBarMotion(
				state.current,
				level.current.rms,
				level.current.speaking,
			);
			const ctx = context();
			if (ctx) drawLevelMeter(ctx, width, height, state.current);
			frame = requestAnimationFrame(loop);
		};
		frame = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(frame);
	}, [width, height, motion]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: context reads the ref.
	useEffect(() => {
		if (motion !== "reduce") return;
		state.current = {
			display: speaking ? rms : rms * 0.2,
			phase: state.current.phase,
		};
		const ctx = context();
		if (ctx) drawLevelMeter(ctx, width, height, state.current);
	}, [rms, speaking, motion, width, height]);
	return (
		<canvas ref={ref} className="voice-canvas" style={{ width, height }} />
	);
}
