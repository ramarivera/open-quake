import { Layer, ManagedRuntime, TestContext } from "effect";
import { prepareProfiles } from "../profiles/index";

/** Bind the production registration and its background fibers to one test clock. */
export function registerTestProfiles(
	...args: Parameters<typeof prepareProfiles>
) {
	const prepared = prepareProfiles(...args);
	const owner = ManagedRuntime.make(
		Layer.merge(prepared.layer, TestContext.TestContext),
	);
	prepared.bind(owner);
	const profiles = prepared.start();
	return {
		...profiles,
		dispose: async () => {
			try {
				await profiles.dispose();
			} finally {
				await owner.dispose();
			}
		},
	};
}
