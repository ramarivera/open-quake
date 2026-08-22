import { useEffect, useState } from "react"

type QuakeEvent = {
	source: "mock" | "hid"
	kind: "rotate" | "press" | "touch" | "keepalive"
	direction?: 1 | -1
	points?: ReadonlyArray<{ action: number; x: number; y: number }>
	seq?: number
}

declare global {
	interface Window {
		openQuake?: {
			onQuakeEvent: (cb: (event: QuakeEvent) => void) => () => void
		}
	}
}

export function useQuakeEvents(): {
	events: QuakeEvent[]
	rotations: number
	presses: number
	lastKeepAliveSeq: number | null
	touchPoints: { x: number; y: number }[]
} {
	const [events, setEvents] = useState<QuakeEvent[]>([])
	useEffect(() => {
		const off = window.openQuake?.onQuakeEvent((event) => {
			setEvents((prev) => [...prev.slice(-99), event])
		})
		return off
	}, [])

	let rotations = 0
	let presses = 0
	let lastKeepAliveSeq: number | null = null
	for (const e of events) {
		if (e.kind === "rotate") rotations += 1
		if (e.kind === "press") presses += 1
		if (e.kind === "keepalive") lastKeepAliveSeq = e.seq ?? null
	}
	const touchPoints = (events.at(-1)?.points ?? []).map((p) => ({
		x: p.x,
		y: p.y,
	}))
	return { events, rotations, presses, lastKeepAliveSeq, touchPoints }
}
