import { Either, ParseResult, Schema } from "effect";
import { ProfileEnvelope } from "./profile-contracts.js";
import { ProfileValidationFailed } from "./profile-errors.js";

export const profileParseFailure = (
	cause: ParseResult.ParseError,
): ProfileValidationFailed =>
	ProfileValidationFailed.fromCause(
		cause,
		ParseResult.ArrayFormatter.formatErrorSync(cause).map((issue) =>
			issue.path.map((part) => (typeof part === "symbol" ? "symbol" : part)),
		),
	);

export const isEncodedProfileEnvelope = (value: unknown): boolean =>
	Either.isRight(
		Schema.decodeUnknownEither(ProfileEnvelope)(value, {
			onExcessProperty: "error",
		}),
	);
