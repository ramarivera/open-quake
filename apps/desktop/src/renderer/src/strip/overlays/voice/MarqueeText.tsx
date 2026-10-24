import { useLayoutEffect, useRef, useState } from "react";

/**
 * One line that scrolls right-to-left when it overflows (AED scroll-text,
 * 10 s; SMB 12 s). DK translates the clipped, ellipsized box itself; here the
 * whole line travels from the right edge until its end leaves the left edge.
 * Reduced motion keeps DK's ellipsis.
 */
export function MarqueeText({
	text,
	seconds,
	motion,
	className,
}: {
	text: string;
	seconds: number;
	motion: "full" | "reduce";
	className: string;
}): React.JSX.Element {
	const box = useRef<HTMLDivElement>(null);
	const line = useRef<HTMLSpanElement>(null);
	const [travel, setTravel] = useState<
		{ readonly from: number; readonly to: number } | undefined
	>();
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the text changes.
	useLayoutEffect(() => {
		const container = box.current;
		const inner = line.current;
		if (!container || !inner) return;
		const overflow = inner.scrollWidth > container.clientWidth;
		setTravel(
			overflow
				? { from: container.clientWidth, to: -inner.scrollWidth }
				: undefined,
		);
	}, [text]);
	const scrolling = travel !== undefined && motion === "full";
	return (
		<div
			ref={box}
			className={className}
			data-scrolling={scrolling ? "true" : undefined}
		>
			<span
				ref={line}
				className="voice-marquee-line"
				style={
					scrolling
						? {
								"--voice-marquee-from": `${travel.from}px`,
								"--voice-marquee-to": `${travel.to}px`,
								animationDuration: `${seconds}s`,
							}
						: undefined
				}
			>
				{text}
			</span>
		</div>
	);
}
