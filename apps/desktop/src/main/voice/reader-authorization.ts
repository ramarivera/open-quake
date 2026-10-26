import { Option, Schema } from "effect";
import { AudioBotConfig } from "../../../../../packages/device/src/actions/action-contracts";
import type { ProfileEnvelope } from "../../../../../packages/device/src/profiles/profile-contracts";
import { readerSettings } from "../../shared/reader-settings";

/** Authorize only the committed, visible AudioBot on this device's active page. */
export function committedReader(
	envelope: ProfileEnvelope,
	serial: string,
	keyCode: string,
) {
	const selection = envelope.activeByDevice[serial];
	const hidden = Option.isSome(envelope.manager)
		? envelope.manager.value.hidden
		: [];
	const visible = envelope.profiles.filter(
		(profile) => !hidden.includes(profile.id),
	);
	const profile = selection
		? visible.find((profile) => profile.id === selection.profileId)
		: visible[0];
	const page = selection
		? profile?.pages.find((page) => page.id === selection.pageId)
		: profile?.pages[0];
	const key = page?.keys.find((key) => key.keyCode === keyCode);
	if (!key?.config.display || !Schema.is(AudioBotConfig)(key.config))
		return undefined;
	return readerSettings(key.config.actions);
}
