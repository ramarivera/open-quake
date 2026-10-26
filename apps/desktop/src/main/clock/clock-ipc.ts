import { Effect, Either, Option, Schema } from "effect";
import {
	type ClockCommand,
	ClockCommand as ClockCommandSchema,
	type ClockReply,
	type ClockSnapshot,
	ClockTarget,
	PANEL_CLOCK_COMMANDS,
} from "../../shared/clock-contracts";
import {
	ClockConfigInvalid,
	type ClockError,
	ClockErrors,
} from "../../shared/clock-errors";
import { ClockStore } from "./clock-store";

/**
 * Only the app's exact renderer document may use the clock bridge. The strip
 * may read and switch themes; every other command needs the management window.
 */
export function canRequestClock(
	caller: string,
	renderer: string,
	input: unknown,
	isManagementWindow: boolean,
): boolean {
	try {
		const url = new URL(caller);
		const expected = new URL(renderer);
		if (
			url.protocol !== expected.protocol ||
			url.host !== expected.host ||
			url.pathname !== expected.pathname
		)
			return false;
		if (isManagementWindow) return true;
		return (
			typeof input === "object" &&
			input !== null &&
			"_tag" in input &&
			PANEL_CLOCK_COMMANDS.some((tag) => tag === input._tag)
		);
	} catch {
		return false;
	}
}

export type ClockMediaTarget =
	| { readonly theme: string; readonly target?: ClockTarget }
	| { readonly candidate: string };

/** Only subresource requests from the app document may read selected files. */
export function canRequestClockMedia(
	caller: string,
	renderer: string,
	resourceType: string,
): boolean {
	return (
		resourceType !== "mainFrame" &&
		resourceType !== "subFrame" &&
		canRequestClock(caller, renderer, { _tag: "read" }, false)
	);
}

/** `oq-clock-media://theme/<id>?r=<rev>` or `oq-clock-media://candidate/<token>`. */
export function parseMediaUrl(input: string): ClockMediaTarget | null {
	try {
		const url = new URL(input);
		const segments = url.pathname.split("/").filter(Boolean);
		const [value, ...rest] = segments;
		if (!value || rest.length) return null;
		if (url.hostname === "theme" && /^[a-z]+$/.test(value)) {
			const encoded = url.searchParams.get("t");
			if (!encoded) return { theme: value };
			const target: unknown = JSON.parse(encoded);
			return Schema.is(ClockTarget)(target) ? { theme: value, target } : null;
		}
		if (url.hostname === "candidate" && /^[a-f0-9]{32}$/.test(value))
			return { candidate: value };
		return null;
	} catch {
		return null;
	}
}

type FailureCode = Extract<ClockReply, { _tag: "failure" }>["code"];
const failure = (error: {
	readonly code: FailureCode;
	readonly message: string;
}): ClockReply => ({
	_tag: "failure",
	code: error.code,
	message: error.message,
});
const success = (snapshot: ClockSnapshot): ClockReply => ({
	_tag: "success",
	snapshot,
});

function execute(
	store: ClockStore,
	command: ClockCommand,
	chooseFile: Effect.Effect<Option.Option<string>>,
): Effect.Effect<ClockReply, ClockError> {
	switch (command._tag) {
		case "read":
			return store.read(command.target).pipe(Effect.map(success));
		case "setTheme":
			return store
				.setTheme(command.keyCode, command.themeId, command.target)
				.pipe(
					Effect.map((outcome): ClockReply => {
						if (outcome.ok) return success(outcome.snapshot);
						const entry =
							outcome.reason === "write-failed"
								? ClockErrors.ClockPersistenceFailed
								: ClockErrors.ClockConfigInvalid;
						return {
							_tag: "failure",
							code: entry.code,
							message: entry.message,
							reason: outcome.reason,
						};
					}),
				);
		case "setMode":
			return store
				.setMode(command.mode, command.target)
				.pipe(Effect.map(success));
		case "setHourFormat":
			return store
				.setHourFormat(command.hourFormat, command.target)
				.pipe(Effect.map(success));
		case "setSeconds":
			return store
				.setSeconds(command.showSeconds, command.target)
				.pipe(Effect.map(success));
		case "chooseMedia":
			return chooseFile.pipe(
				Effect.flatMap(
					Option.match({
						onNone: () => store.read(command.target).pipe(Effect.map(success)),
						onSome: (path) =>
							store.stageMedia(command.themeId, path, command.target).pipe(
								Effect.map(
									(staged): ClockReply =>
										staged._tag === "saved"
											? success(staged.snapshot)
											: {
													_tag: "candidate",
													themeId: staged.candidate.themeId,
													token: staged.candidate.token,
													url: `oq-clock-media://candidate/${staged.candidate.token}`,
													name: staged.candidate.name,
												},
								),
							),
					}),
				),
			);
		case "commitMedia":
			return store
				.commitMedia(command.token, command.durationMs)
				.pipe(Effect.map(success));
		case "restoreMedia":
			return store
				.restoreMedia(command.themeId, command.target)
				.pipe(Effect.map(success));
	}
}

/**
 * Decodes one bridge command and runs it. `chooseFile` is the main-process
 * dialog (none when cancelled). Errors become typed failure replies by tag.
 */
export const handleClockCommand = Effect.fn("Clock.handleCommand")(function* (
	input: unknown,
	chooseFile: Effect.Effect<Option.Option<string>>,
) {
	const store = yield* ClockStore;
	const decoded = Schema.decodeUnknownEither(ClockCommandSchema)(input);
	if (Either.isLeft(decoded))
		return failure(ClockConfigInvalid.fromCause(decoded.left));
	return yield* execute(store, decoded.right, chooseFile).pipe(
		Effect.catchTags({
			ClockConfigInvalid: (error) => Effect.succeed(failure(error)),
			ClockPersistenceFailed: (error) => Effect.succeed(failure(error)),
			ClockMediaUnusable: (error) => Effect.succeed(failure(error)),
			ClockMediaTooShort: (error) => Effect.succeed(failure(error)),
		}),
	);
});
