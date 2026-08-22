import { frameHostCommand } from "@open-quake/protocol";
import { Effect } from "effect";

/**
 * Conductor wrapper over the QUAKE control protocol.
 * Skeleton: proves cross-package wiring; real transport arrives with the
 * device facade design (wayfinder ticket open-quake-2qs.6).
 */
export class QuakeDevice extends Effect.Service<QuakeDevice>()("QuakeDevice", {
	accessors: true,
	effect: Effect.gen(function* () {
		const keepAlivePing = Effect.sync(() => frameHostCommand(2, [0xef]));

		return { keepAlivePing };
	}),
}) {}

export const QuakeDeviceLive = QuakeDevice.Default;
