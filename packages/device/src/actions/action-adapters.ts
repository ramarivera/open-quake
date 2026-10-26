import { Context, type Effect, type Option } from "effect";
import type {
	CommittedActionSnapshot,
	MediaCommand,
} from "./action-contracts.js";
import type { ActionSnapshotFailed, HostActionError } from "./action-errors.js";

export interface KeyboardActionAdapter {
	readonly supportedTokens: ReadonlySet<string>;
	/** Atomic chord. The adapter owns modifier release, including on failure/cancellation. */
	readonly pressChord: (chord: string) => Effect.Effect<void, HostActionError>;
}
export interface TextActionAdapter {
	/** Exact Unicode text including line breaks. Never adds an implicit enter. */
	readonly insertText: (text: string) => Effect.Effect<void, HostActionError>;
}
export interface WebsiteActionAdapter {
	readonly openUrl: (url: string) => Effect.Effect<void, HostActionError>;
}
export interface ApplicationActionAdapter {
	/** A selected reference or absolute path, never a shell command. Check host support here. */
	readonly launchApplication: (
		reference: string,
	) => Effect.Effect<void, HostActionError>;
}
export interface MediaActionAdapter {
	readonly observe?: (
		listener: (reading: {
			readonly level: number;
			readonly muted: boolean;
		}) => void,
	) => () => void;

	readonly supportedCommands: ReadonlySet<MediaCommand>;
	readonly sendMedia: (
		command: MediaCommand,
	) => Effect.Effect<void, HostActionError>;
}
/** No live OS defaults. Composition supplies explicit capabilities. */
export class ActionHostAdapters extends Context.Tag(
	"@open-quake/device/ActionHostAdapters",
)<
	ActionHostAdapters,
	{
		readonly keyboard: Option.Option<KeyboardActionAdapter>;
		readonly text: Option.Option<TextActionAdapter>;
		readonly website: Option.Option<WebsiteActionAdapter>;
		readonly application: Option.Option<ApplicationActionAdapter>;
		readonly media: Option.Option<MediaActionAdapter>;
	}
>() {}
/** This minimal read seam avoids importing the concurrent profiles implementation. */
export class ActionProfileSource extends Context.Tag(
	"@open-quake/device/ActionProfileSource",
)<
	ActionProfileSource,
	{
		readonly readCommitted: (
			deviceId: string,
		) => Effect.Effect<
			Option.Option<CommittedActionSnapshot>,
			ActionSnapshotFailed
		>;
	}
>() {}
