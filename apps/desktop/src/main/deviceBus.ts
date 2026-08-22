import { EventEmitter } from "node:events"

/**
 * Device event bus for the prototype.
 *
 * MOCK SOURCE, clearly labeled: emits synthetic knob/touch/keep-alive events
 * on timers. The real node-hid transport replaces `startMockSource` only -
 * consumers (panel renderer, management window) stay identical.
 */
export type QuakeEvent =
	| { source: "mock" | "hid"; kind: "rotate"; direction: 1 | -1 }
	| { source: "mock" | "hid"; kind: "press" }
	| {
			source: "mock" | "hid"
			kind: "touch"
			points: ReadonlyArray<{ action: number; x: number; y: number }>
	  }
	| { source: "mock" | "hid"; kind: "keepalive"; seq: number }

const KEEPALIVE_INTERVAL_MS = 3000

export type DeviceBus = {
	on(listener: (event: QuakeEvent) => void): () => void
	stop(): void
}

export function startDeviceBus(): DeviceBus {
	const emitter = new EventEmitter()
	const timers: ReturnType<typeof setInterval>[] = []
	let seq = 0
	let direction: 1 | -1 = 1

	timers.push(
		setInterval(() => {
			direction = Math.random() > 0.8 ? ((direction * -1) as 1 | -1) : direction
			emitter.emit("event", {
				source: "mock",
				kind: "rotate",
				direction,
			} satisfies QuakeEvent)
		}, 1500),
	)
	timers.push(
		setInterval(() => {
			emitter.emit("event", {
				source: "mock",
				kind: "press",
			} satisfies QuakeEvent)
		}, 6000),
	)
	timers.push(
		setInterval(() => {
			seq += 1
			emitter.emit("event", {
				source: "mock",
				kind: "keepalive",
				seq,
			} satisfies QuakeEvent)
		}, KEEPALIVE_INTERVAL_MS),
	)

	return {
		on(listener) {
			emitter.on("event", listener)
			return () => emitter.off("event", listener)
		},
		stop() {
			for (const t of timers) clearInterval(t)
			emitter.removeAllListeners()
		},
	}
}
