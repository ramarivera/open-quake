import { it } from "@effect/vitest";
import { Effect, Layer, TestClock } from "effect";
import { expect } from "vitest";
import {
	type ChannelPortShape,
	ChannelPorts,
	ChannelService,
} from "./channel-service.js";

const ports = (cancel: () => void): ChannelPortShape => ({
	store: {
		read: async () => ({ version: 1, channels: [] }),
		write: async () => {},
	},
	vault: {
		put: async () => "ref",
		get: async () => "{}",
		remove: async () => {},
	},
	now: () => 0,
	id: () => "session",
	runtime: {
		status: async () => ({ available: true, reason: "", connected: [] }),
		configure: async () => {},
		remove: async () => {},
		startQr: async (_id, _session, receive) => {
			receive({ url: "https://example.test/qr" });
			return cancel;
		},
		pairings: async () => [],
		approve: async () => {},
	},
});
it.effect(
	"expires a real consumer QR session at five minutes without renderer polling",
	() => {
		let cancelled = 0;
		return Effect.gen(function* () {
			const service = yield* ChannelService;
			const session = yield* service.startQr("whatsapp");
			expect(session.state).toBe("ready");
			yield* TestClock.adjust("5 minutes");
			const expired = yield* service.readQr(session.id);
			expect(expired.state).toBe("expired");
			expect(expired.url).toBe("");
			expect(cancelled).toBe(1);
			yield* service.cancelQr(session.id);
			expect(cancelled).toBe(1);
		}).pipe(
			Effect.provide(
				ChannelService.Default.pipe(
					Layer.provide(
						Layer.succeed(
							ChannelPorts,
							ports(() => {
								cancelled++;
							}),
						),
					),
				),
			),
		);
	},
);
