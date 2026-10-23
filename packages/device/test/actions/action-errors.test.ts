import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Either, Option, Schema, TestClock } from "effect";
import {
	ActionApplicationMissing,
	ActionPermissionDenied,
	ActionService,
	ActionSnapshotFailed,
	HostActionFailed,
	InvalidKeyAction,
	KeyFunctionUnavailable,
} from "../../src/actions/index.js";
import { config, harness, press } from "./action-harness.js";

describe("catalog failures through the real action consumer", () => {
	it("round trips validation and unavailability errors without retaining wire payloads as causes", () => {
		const original = Object.assign(new Error("private-input"), {
			code: "EACCES",
		});
		const invalid = new InvalidKeyAction("config.actions", original);
		const encodedInvalid = Schema.encodeSync(InvalidKeyAction)(invalid);
		const decodedInvalid =
			Schema.decodeUnknownSync(InvalidKeyAction)(encodedInvalid);
		expect(decodedInvalid).toBeInstanceOf(InvalidKeyAction);
		expect(Schema.encodeSync(InvalidKeyAction)(decodedInvalid)).toEqual(
			encodedInvalid,
		);
		expect(decodedInvalid.originalCause).toBeUndefined();
		expect(invalid.originalCause).toBe(original);
		const unavailable = new KeyFunctionUnavailable("adapter-missing");
		const encodedUnavailable = Schema.encodeSync(KeyFunctionUnavailable)(
			unavailable,
		);
		const decodedUnavailable = Schema.decodeUnknownSync(KeyFunctionUnavailable)(
			encodedUnavailable,
		);
		expect(decodedUnavailable).toBeInstanceOf(KeyFunctionUnavailable);
		expect(
			Schema.encodeSync(KeyFunctionUnavailable)(decodedUnavailable),
		).toEqual(encodedUnavailable);
		expect(decodedUnavailable.originalCause).toBeUndefined();
	});

	for (const ErrorClass of [
		ActionPermissionDenied,
		ActionApplicationMissing,
		HostActionFailed,
	]) {
		it.effect(
			`preserves ${ErrorClass.name}, private cause and no automatic retries`,
			() => {
				const original = Object.assign(
					new Error(
						"token=secret https://private.example/path /Users/private/app text-secret",
						{ cause: new TypeError("nested-secret") },
					),
					{ code: "EACCES" },
				);
				const failure = new ErrorClass(original);
				const h = harness("open", config("open", "/Users/private/app", "path"));
				let attempts = 0;
				const before = structuredClone(h.snapshot);
				return Effect.gen(function* () {
					const service = yield* ActionService;
					const result = yield* Effect.either(service.activate(press));
					expect(result._tag).toBe("Left");
					if (Either.isLeft(result)) {
						let source = result.left;
						while (source !== Cause.originalError(source))
							source = Cause.originalError(source);
						expect(source).toBe(failure);
						expect(source.code).toBe(failure.code);
						expect(source._tag).toBe(failure._tag);
						expect(
							Schema.decodeUnknownEither(
								Schema.Union(
									ActionPermissionDenied,
									ActionApplicationMissing,
									HostActionFailed,
								),
							)({ ...failure, code: "QUAKE.WRONG.CODE" })._tag,
						).toBe("Left");
						expect(source.originalCause).toBe(original);
						expect(source.recoverable).toBe(true);
						expect(Object.keys(source)).not.toContain("originalCause");
						const projection = Schema.encodeSync(
							Schema.Union(
								ActionPermissionDenied,
								ActionApplicationMissing,
								HostActionFailed,
							),
						)(failure);
						for (const secret of [
							"secret",
							"private",
							"/Users",
							"originalCause",
						])
							expect(JSON.stringify(projection)).not.toContain(secret);
						expect(source.diagnosticCause.sourceCode).toBe("EACCES");
					}
					yield* TestClock.adjust(60_000);
					expect(yield* service.activate(press)).toBe("ignored");
					expect(
						yield* service.activate({ ...press, kind: "repeat", sequence: 2 }),
					).toBe("ignored");
					expect(
						yield* service.activate({ ...press, kind: "release", sequence: 3 }),
					).toBe("ignored");
					expect(attempts).toBe(1);
					expect(h.snapshot).toEqual(before);
				}).pipe(
					Effect.provide(
						h.layer({
							...h.adapters,
							application: Option.some({
								launchApplication: () =>
									Effect.suspend(() => {
										attempts++;
										return Effect.fail(failure);
									}),
							}),
						}),
					),
				);
			},
		);
	}
	it.effect(
		"distinguishes missing adapters from broken profile dependencies",
		() => {
			const h = harness();
			const cause = new Error("private-profile-value");
			const failure = new ActionSnapshotFailed(cause);
			return Effect.gen(function* () {
				const missing = yield* Effect.either(
					ActionService.activate(press).pipe(
						Effect.provide(h.layer({ ...h.adapters, website: Option.none() })),
					),
				);
				if (Either.isLeft(missing))
					expect(missing.left.code).toBe("QUAKE.ACTION.UNAVAILABLE");
				const broken = yield* Effect.either(
					ActionService.activate(press).pipe(
						Effect.provide(
							h.layer(h.adapters, {
								readCommitted: () => Effect.fail(failure),
							}),
						),
					),
				);
				if (Either.isLeft(broken)) {
					expect(broken.left.code).toBe("QUAKE.ACTION.SNAPSHOT_FAILED");
					expect(broken.left.originalCause).toBe(cause);
					expect(JSON.stringify(broken.left)).not.toContain(
						"private-profile-value",
					);
				}
				expect(h.calls).toEqual([]);
			});
		},
	);
	it("pins validation/unavailability identity and bounds hostile cause chains", () => {
		const cause = new Error("private-input");
		cause.cause = cause;
		const error = new InvalidKeyAction("config.actions", cause);
		expect(error.originalCause).toBe(cause);
		expect(
			JSON.stringify(Schema.encodeSync(InvalidKeyAction)(error)),
		).not.toContain("private-input");
		expect(error.diagnosticCause.cause?.cause?.cause?.cause?.name).toBe(
			"TruncatedCause",
		);
		const unavailable = new KeyFunctionUnavailable("adapter-missing");
		expect(Schema.encodeSync(KeyFunctionUnavailable)(unavailable).code).toBe(
			"QUAKE.ACTION.UNAVAILABLE",
		);
	});
});
