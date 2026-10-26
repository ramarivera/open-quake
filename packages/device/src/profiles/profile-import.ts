import { Either, ParseResult, Schema } from "effect";
import { validateAction } from "../actions/action-invariants.js";
import { findAction } from "../actions/action-registry.js";
import {
	Profile,
	ProfileJson,
	ProfileJsonObject,
	ProfileKey,
} from "./profile-contracts.js";

export const ImportDiagnostic = Schema.Struct({
	code: Schema.Literal(
		"unknown-function",
		"missing-optional",
		"legacy-sentinel",
		"invalid-field",
		"invalid-action",
	),
	path: Schema.String,
	blocking: Schema.Boolean,
});
export const ProfileImportReport = Schema.Struct({
	diagnostics: Schema.Array(ImportDiagnostic),
	profile: Schema.optional(Schema.encodedSchema(Profile)),
});
export type ProfileImportReport = typeof ProfileImportReport.Type;
const record = (input: unknown) => {
	const decoded = Schema.decodeUnknownEither(ProfileJsonObject)(input);
	return decoded._tag === "Right" ? decoded.right : undefined;
};

/** No evaluation, host IO or action execution. Original JSON stays inert. */
export function inspectProfileImport(input: unknown): ProfileImportReport {
	const diagnostics: (typeof ImportDiagnostic.Type)[] = [];
	const report = (
		code: typeof ImportDiagnostic.Type.code,
		path: string,
		blocking = false,
	) => diagnostics.push({ code, path, blocking });
	const normalizeKey = (input: unknown, path: string) => {
		const source = record(input);
		const config = record(source?.config);
		if (!source || !config) {
			report("invalid-field", path, true);
			return input;
		}
		const next = { ...config };
		for (const field of [
			"supportKnob",
			"supportTouchEffect",
			"alterTitle",
			"alterIcon",
			"subActions",
			"basicEditableItems",
			"compatibility",
		]) {
			if (!(field in config))
				report("missing-optional", `${path}.config.${field}`);
			else if (config[field] === null) {
				report("legacy-sentinel", `${path}.config.${field}`);
				delete next[field];
			}
		}
		if (Array.isArray(config.actions))
			next.actions = config.actions.filter((action, index) => {
				const a = record(action);
				if (
					action === null ||
					(a && (Object.keys(a).length === 0 || a.type === ""))
				) {
					report("legacy-sentinel", `${path}.config.actions.${index}`);
					return false;
				}
				return true;
			});
		if (config.type === "" && source.childrenName === "")
			report("legacy-sentinel", `${path}.childrenName`);
		let unsupported = record(source.compatibility)?.unsupported === true;
		if (typeof config.type === "string" && config.type !== "") {
			if (!findAction(config.type)) {
				report("unknown-function", `${path}.config.type`);
				unsupported = true;
			} else if (validateAction(config.type, next)._tag === "Left") {
				report("invalid-action", `${path}.config.actions`);
				unsupported = true;
			}
		}
		const candidate = {
			...source,
			...(source.childrenName === "" || source.childrenName === null
				? { childrenName: undefined }
				: {}),
			config: next,
			compatibility: { ...record(source.compatibility), unsupported, source },
		};
		if (candidate.childrenName === undefined) delete candidate.childrenName;
		const decoded = Schema.decodeUnknownEither(ProfileKey)(candidate);
		if (decoded._tag === "Left") {
			for (const issue of ParseResult.ArrayFormatter.formatErrorSync(
				decoded.left,
			))
				report(
					"invalid-field",
					`${path}.${issue.path.map(String).join(".")}`,
					true,
				);
			return candidate;
		}
		return Schema.encodeSync(ProfileKey)(decoded.right);
	};
	const source = record(input);
	const legacy = Array.isArray(input);
	const rawPages = legacy
		? [{ id: "import-page", keys: input }]
		: source?.pages;
	if (!Array.isArray(rawPages) || !rawPages.length) {
		report("invalid-field", "pages", true);
		return { diagnostics };
	}
	let knob = source?.knob;
	const pages = rawPages.map((value, index) => {
		const page = record(value);
		if (!page || !Array.isArray(page.keys)) {
			report("invalid-field", `pages.${index}.keys`, true);
			return value;
		}
		const keys = page.keys.flatMap((key, keyIndex) => {
			if (key === null) {
				report("legacy-sentinel", `pages.${index}.keys.${keyIndex}`);
				return [];
			}
			if (legacy && record(key)?.keyCode === "0,1") {
				if (knob) report("invalid-field", "knob", true);
				knob = key;
				return [];
			}
			return [normalizeKey(key, `pages.${index}.keys.${keyIndex}`)];
		});
		return { ...page, keys };
	});
	const candidate = {
		...(legacy
			? { id: "import", name: "Imported profile", revision: 0 }
			: source),
		pages,
		...(knob ? { knob } : {}),
		compatibility: { ...record(source?.compatibility), source: input },
	};
	const decoded = Schema.decodeUnknownEither(Profile)(candidate);
	if (decoded._tag === "Left") {
		for (const issue of ParseResult.ArrayFormatter.formatErrorSync(
			decoded.left,
		))
			report("invalid-field", issue.path.map(String).join("."), true);
		return { diagnostics };
	}
	return diagnostics.some((d) => d.blocking)
		? { diagnostics }
		: { diagnostics, profile: Schema.encodeSync(Profile)(decoded.right) };
}

export function inspectProfileText(text: string): ProfileImportReport {
	const decoded = Schema.decodeUnknownEither(Schema.parseJson(ProfileJson))(
		text,
	);
	return Either.isRight(decoded)
		? inspectProfileImport(decoded.right)
		: { diagnostics: [{ code: "invalid-field", path: "$", blocking: true }] };
}
