import { Schema } from "effect";
import { SequenceLeaf } from "./action-contracts.js";
import { ACTION_REGISTRY } from "./action-registry.js";

const isSequenceLeaf = Schema.is(Schema.encodedSchema(SequenceLeaf));
const editableSequenceTypes = new Set([
	"website",
	"hotkey",
	"open",
	"text",
	"close",
	"cmd",
]);

/** Selection admits incomplete editable drafts; execution still validates each leaf. */
export function isSequenceSelectable(id: string): boolean {
	const entry = ACTION_REGISTRY.find((entry) => entry.id === id);
	return (
		id === "delay" ||
		(!!entry &&
			(editableSequenceTypes.has(id) || isSequenceLeaf(entry.defaultConfig)))
	);
}

/** Active MULTIACTIONS_SIDEBAR entries, including the separately grouped shell action.
 * Keep unsupported runtime operations visible without broadening executable validation. */
export const SEQUENCE_LIBRARY = [
	{ subMenu: "decoKeeAI", ids: ["buzzer", "mic", "homeAssistant"] },
	{
		subMenu: "shortcut",
		ids: [
			"website",
			"hotkey",
			"open",
			"close",
			"text",
			"playAudioLegacy",
			"stopAudio",
			"delay",
		],
	},
	{ subMenu: "deviceControl", ids: ["mute"] },
	{
		subMenu: "multiMedia",
		ids: [
			"playPause",
			"stopPlay",
			"skipBackward",
			"skipForward",
			"fastBackward",
			"fastForward",
			"repeatPlay",
			"randomPlay",
		],
	},
	{ subMenu: "system", ids: ["cmd"] },
] as const;
export function allowedInSequence(
	id: string,
	plugin?: { readonly SupportedInMultiActions?: boolean },
): boolean {
	return plugin
		? plugin.SupportedInMultiActions !== false
		: SEQUENCE_LIBRARY.some((group) => group.ids.some((value) => value === id));
}
