import { Effect } from "effect";
import { DisplayOperationFailed } from "./native-display";

export function makePowerOwner(edge: {
	start(type: "prevent-app-suspension"): number;
	stop(id: number): void;
}) {
	let id: number | undefined;
	const setCount = Effect.fn("PanelPower.setCount")(
		(count: number): Effect.Effect<void, DisplayOperationFailed> =>
			Effect.try({
				try: () => {
					if (count > 0 && id === undefined)
						id = edge.start("prevent-app-suspension");
					if (count === 0 && id !== undefined) {
						edge.stop(id);
						id = undefined;
					}
				},
				catch: (cause) => new DisplayOperationFailed(cause),
			}),
	);
	return { setCount, close: () => setCount(0) };
}
