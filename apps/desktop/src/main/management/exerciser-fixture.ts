import { Effect } from "effect";
import type { ProfileEnvelope } from "../../../../../packages/device/src/profiles/profile-contracts";
import { ProfileRepository } from "../../../../../packages/device/src/profiles/profile-repository";
import { emptyEmojiStore } from "../../../../../packages/edge/src/emoji/emoji-contracts";
import { EmojiRepository } from "../../../../../packages/edge/src/emoji/emoji-repository";
import type { DesktopRuntime } from "../diagnostics/module";

/** Only imported by the opt-in fixture build. Reset through the production store owner. */
let reset: ((envelope: ProfileEnvelope) => Promise<void>) | undefined;
export function bindFixtureStore<R>(
	runtime: DesktopRuntime<R | ProfileRepository | EmojiRepository>,
) {
	reset = async (envelope) => {
		await runtime.runPromise(
			Effect.flatMap(ProfileRepository, (repo) =>
				repo.transact(() => Effect.succeed(envelope)),
			),
		);
		await runtime.runPromise(
			Effect.flatMap(EmojiRepository, (repo) =>
				repo.transact(() => Effect.succeed(emptyEmojiStore)),
			),
		);
	};
}
export async function resetFixtureStore(
	envelope: ProfileEnvelope,
): Promise<void> {
	if (!reset) throw new Error("Fixture store is not bound");
	await reset(envelope);
}
