import { Either, ParseResult, Schema } from "effect";
import { legacyDiagnosticCode } from "../../../edge/src/ai/legacy-diagnostics.js";
import {
	legacyAssistantState,
	migrateLegacyAiConfig,
} from "../../../edge/src/ai/provider-catalog.js";
import { validateAction } from "../actions/action-invariants.js";
import { findAction } from "../actions/action-registry.js";
import { actionProfileFunctionContracts } from "../actions/profile-function-contracts.js";
import {
	Profile,
	ProfileJson,
	ProfileJsonObject,
	ProfileKey,
} from "./profile-contracts.js";
import {
	type ProfileFunctionContract,
	profileKeyFunctionIssues,
} from "./profile-function-contracts.js";

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

const isPageReference = (type: string, value: unknown): boolean =>
	["folder", "emojiFolderId", "parentFolder"].includes(type) ||
	(type === "page" && typeof value === "string");

/** Allocate every destination before rewriting links, including forward references. */
export function remapImportedProfile(
	profile: typeof Profile.Encoded,
	id: string,
) {
	const ids = new Map(
		profile.pages.map((page, i) => [page.id, `${id}-page-${i + 1}`]),
	);
	return {
		...profile,
		id,
		revision: 0,
		pages: profile.pages.map((page, i) => ({
			...page,
			id: `${id}-page-${i + 1}`,
			keys: page.keys.map((key) => ({
				...key,
				config: {
					...key.config,
					actions: (key.config.actions ?? []).map((action) =>
						isPageReference(action.type, action.value) &&
						typeof action.value === "string"
							? { ...action, value: ids.get(action.value) ?? "" }
							: action,
					),
				},
			})),
		})),
	};
}

/** No evaluation, host IO or action execution. Original JSON stays inert. */
export function inspectProfileImport(
	input: unknown,
	contracts: ReadonlyMap<
		string,
		ProfileFunctionContract
	> = actionProfileFunctionContracts,
): ProfileImportReport {
	const diagnostics: (typeof ImportDiagnostic.Type)[] = [];
	const report = (
		code: typeof ImportDiagnostic.Type.code,
		path: string,
		blocking = false,
	) => diagnostics.push({ code, path, blocking });
	const normalizeKey = (input: unknown, path: string, pageId?: string) => {
		const source = record(input);
		const config = record(source?.config);
		if (!source || !config) {
			report("invalid-field", path, true);
			return input;
		}
		const next = { ...config };
		if (typeof config.errorCode === "number") {
			const diagnosticCode = legacyDiagnosticCode(config.errorCode);
			if (diagnosticCode)
				next.compatibility = {
					...record(config.compatibility),
					legacyErrorCode: config.errorCode,
					diagnosticCode,
				};
		}
		const ai = record(config.aiConfigData);
		if (ai) {
			const migrated = migrateLegacyAiConfig(ai);
			const decoded = Schema.decodeUnknownEither(ProfileJsonObject)(migrated);
			if (Either.isRight(decoded)) next.aiConfigData = decoded.right;
		}
		for (const field of ["sessionState", "animationState", "assistantType"]) {
			const value = config[field];
			if (typeof value === "string") {
				const mapped = legacyAssistantState(value);
				if (mapped) next[field] = mapped.state;
			}
		}
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
		if (Array.isArray(next.actions))
			next.actions = next.actions.map((action, index) => {
				const a = record(action);
				if (
					!a ||
					typeof a.type !== "string" ||
					!isPageReference(a.type, a.value)
				)
					return action;
				if (
					typeof a.value === "string" &&
					pageIds.has(a.value) &&
					!(
						pageId &&
						["createFolder", "emojiFolder"].includes(String(config.type)) &&
						a.type !== "parentFolder" &&
						closesFolderCycle(pageId, a.value)
					)
				)
					return action;
				report("invalid-action", `${path}.config.actions.${index}.value`);
				unsupported = true;
				// Keep the complete original in compatibility.source. Empty destinations
				// cannot accidentally bind to a page allocated later during import.
				return { ...a, value: "" };
			});
		if (typeof config.type === "string" && config.type !== "") {
			if (!contracts.has(config.type)) {
				report("unknown-function", `${path}.config.type`);
				unsupported = true;
			} else if (
				findAction(config.type) &&
				validateAction(config.type, next)._tag === "Left"
			) {
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
		const issues = profileKeyFunctionIssues(decoded.right, contracts);
		for (const issue of issues)
			report("invalid-action", `${path}.${issue.map(String).join(".")}`);
		const encoded = Schema.encodeSync(ProfileKey)(decoded.right);
		return issues.length > 0
			? {
					...encoded,
					compatibility: { ...encoded.compatibility, unsupported: true },
				}
			: encoded;
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
	const pageIds = new Set(
		rawPages.flatMap((page) => {
			const id = record(page)?.id;
			return typeof id === "string" ? [id] : [];
		}),
	);
	// Back actions are return associations, not forward folder edges.
	const folderLinks = new Map<string, readonly string[]>();
	for (const value of rawPages) {
		const page = record(value);
		if (typeof page?.id !== "string" || !Array.isArray(page.keys)) continue;
		folderLinks.set(
			page.id,
			page.keys.flatMap((key) => {
				const config = record(record(key)?.config);
				if (
					!config ||
					!["createFolder", "emojiFolder"].includes(String(config.type)) ||
					!Array.isArray(config.actions)
				)
					return [];
				return config.actions.flatMap((action) => {
					const a = record(action);
					return a &&
						typeof a.type === "string" &&
						a.type !== "parentFolder" &&
						typeof a.value === "string" &&
						pageIds.has(a.value) &&
						isPageReference(a.type, a.value)
						? [a.value]
						: [];
				});
			}),
		);
	}
	const closesFolderCycle = (from: string, to: string): boolean => {
		const pending = [to];
		const visited = new Set<string>();
		while (pending.length) {
			const page = pending.pop();
			if (page === from) return true;
			if (page === undefined || visited.has(page)) continue;
			visited.add(page);
			pending.push(...(folderLinks.get(page) ?? []));
		}
		return false;
	};
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
			return [
				normalizeKey(
					key,
					`pages.${index}.keys.${keyIndex}`,
					typeof page.id === "string" ? page.id : undefined,
				),
			];
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

export function inspectProfileText(
	text: string,
	contracts: ReadonlyMap<
		string,
		ProfileFunctionContract
	> = actionProfileFunctionContracts,
): ProfileImportReport {
	const decoded = Schema.decodeUnknownEither(Schema.parseJson(ProfileJson))(
		text,
	);
	return Either.isRight(decoded)
		? inspectProfileImport(decoded.right, contracts)
		: { diagnostics: [{ code: "invalid-field", path: "$", blocking: true }] };
}
