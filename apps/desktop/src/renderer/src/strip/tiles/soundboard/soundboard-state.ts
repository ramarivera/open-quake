import { importSoundConfig } from "../../../../../../../../packages/edge/src/soundboard/soundboard-invariants";
import type { ProfileKey } from "../../../../../shared/profiles";

/** Only the empty system-media preset can offer OS transport controls. */
export function soundboardOwned(
	config: Pick<ProfileKey["config"], "type" | "actions">,
): boolean {
	const source = config.actions.find((a) => a.type === "musicSource")?.value;
	if (source === "local") return true;
	if (source === "system") return false;
	if (config.type === "playAudioLegacy") return true;
	if (config.type !== "playAudio") return false;
	const sounds = config.actions.filter((action) => action.type === "sound");
	const operations = config.actions.filter(
		(action) => action.type === "audioAction",
	);
	return (
		sounds.length !== 1 ||
		sounds[0]?.value !== "" ||
		operations.length !== 1 ||
		operations[0]?.value !== 0
	);
}

export function soundboardConfigured(
	config: Pick<ProfileKey["config"], "type" | "actions">,
): boolean {
	const parsed = importSoundConfig({
		...config,
		actions: config.actions.filter((a) => a.type !== "musicSource"),
	});
	return (
		soundboardOwned(config) &&
		parsed._tag === "Right" &&
		parsed.right.issues.every((issue) => issue === "unverifiedFiles")
	);
}
