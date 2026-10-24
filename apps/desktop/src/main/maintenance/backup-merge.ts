import { Schema } from "effect";
import {
	builtinProfiles,
	isBuiltinProfile,
} from "../../../../../packages/device/src/profiles/profile-catalog.js";
import {
	encodeProfileEnvelope,
	Profile,
	ProfileEnvelope,
	ProfileJson,
	ProfileJsonObject,
	ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { BackupInvalid } from "../../../../../packages/edge/src/maintenance/maintenance-errors.js";
import { decodeAccountConfig, encodeAccountConfig } from "./account-config";
import {
	type ArchiveFiles,
	ExportIndex,
	safeArchivePath,
} from "./backup-archive";
import { backupPaths } from "./backup-paths";
import { hashBytes } from "./firmware-files";

const Resource = Schema.Struct({
	id: Schema.Union(Schema.String, Schema.Number),
	name: Schema.String,
	path: Schema.String,
	resourceType: Schema.String,
	isDelete: Schema.optional(Schema.Boolean),
});
const ResourceGroups = Schema.Array(
	Schema.Struct({ data: Schema.Array(Resource) }),
);
const json = (bytes: Uint8Array | undefined): unknown => {
	if (!bytes) throw new BackupInvalid();
	return JSON.parse(Buffer.from(bytes).toString("utf8"));
};
const stable = (value: unknown): string => {
	if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
	if (value && typeof value === "object")
		return `{${Object.entries(value)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
			.join(",")}}`;
	return JSON.stringify(value) ?? "null";
};
const keyFingerprint = (keys: readonly unknown[]): string =>
	stable(
		keys
			.map((key) => Schema.decodeUnknownSync(ProfileJsonObject)(key))
			.sort((a, b) => String(a.keyCode).localeCompare(String(b.keyCode))),
	);
export function withoutCredentials(value: ProfileJson): ProfileJson {
	if (Array.isArray(value))
		return value
			.filter(
				(item) =>
					!(
						item &&
						typeof item === "object" &&
						!Array.isArray(item) &&
						"type" in item &&
						typeof item.type === "string" &&
						/(api.?key|token|password|secret|credential)/i.test(item.type)
					),
			)
			.map(withoutCredentials);
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value)
				.filter(
					([k]) => !/(api.?key|token|password|secret|credential)/i.test(k),
				)
				.map(([k, v]) => [k, withoutCredentials(v)]),
		);
	return value;
}
function archiveRelative(path: string, base: string): string {
	const normalized = path.replaceAll("\\", "/");
	const root = base.replaceAll("\\", "/").replace(/\/$/, "");
	if (!normalized.startsWith(`${root}/`)) throw new BackupInvalid();
	return safeArchivePath(normalized.slice(root.length + 1));
}
export interface BackupMerge {
	readonly envelope: typeof ProfileEnvelope.Encoded;
	readonly resources: ReadonlyMap<string, Uint8Array>;
	readonly legacyFiles: ReadonlyMap<string, Uint8Array>;
	readonly imported: number;
	readonly skipped: number;
}
export function mergeBackup(
	files: ArchiveFiles,
	current: unknown,
	destination: string,
	existingResources: ReadonlySet<string> = new Set(),
): BackupMerge {
	const envelope = Schema.decodeUnknownSync(ProfileEnvelope)(current);
	const index = Schema.decodeUnknownSync(ExportIndex)(
		json(files.get("export_index.json")),
	);
	const native = files.get("open-quake/profiles-v1.json");
	const portable = backupPaths(files, destination);
	if (native) {
		const imported = Schema.decodeUnknownSync(ProfileEnvelope)(
			portable.rewrite(
				withoutCredentials(Schema.decodeUnknownSync(ProfileJson)(json(native))),
			),
		);
		const profiles = [...envelope.profiles];
		let skipped = 0;
		let added = 0;
		for (const profile of imported.profiles) {
			const encoded = Schema.encodeSync(Profile)(profile);
			const fingerprint = hashBytes(
				Buffer.from(stable({ pages: encoded.pages, knob: encoded.knob })),
			);
			if (
				profiles.some((p) => {
					const existing = Schema.encodeSync(Profile)(p);
					return (
						hashBytes(
							Buffer.from(
								stable({ pages: existing.pages, knob: existing.knob }),
							),
						) === fingerprint
					);
				})
			) {
				skipped++;
				continue;
			}
			const id = `import-${fingerprint}`;
			profiles.push(
				Schema.decodeUnknownSync(Profile)({ ...encoded, id, revision: 0 }),
			);
			added++;
		}
		return {
			envelope: encodeProfileEnvelope({
				...envelope,
				profiles: Schema.decodeUnknownSync(ProfileEnvelope)({
					...encodeProfileEnvelope(envelope),
					profiles: profiles.map((p) => Schema.encodeSync(Profile)(p)),
				}).profiles,
			}),
			resources: new Map(),
			legacyFiles: portable.legacyFiles,
			imported: added,
			skipped,
		};
	}
	const groups = Schema.decodeUnknownSync(ResourceGroups)(
		json(files.get("app/assets/resources.conf")),
	);
	const configEntry = [...files].find(([name]) =>
		/^[^/]+_config\.json$/.test(name),
	);
	const accountConfig = configEntry
		? decodeAccountConfig(
				configEntry[1],
				configEntry[0].slice(0, -"_config.json".length),
			)
		: {};
	const menuResult = Schema.decodeUnknownEither(
		Schema.Struct({
			quakeConfig: Schema.Struct({
				deviceMenuProfile: Schema.Array(
					Schema.Struct({
						resourceId: Schema.Union(Schema.String, Schema.Number),
						title: Schema.String,
					}),
				),
			}),
		}),
	)(accountConfig);
	const profileNames = new Map(
		menuResult._tag === "Right"
			? menuResult.right.quakeConfig.deviceMenuProfile.map((p) => [
					String(p.resourceId),
					p.title,
				])
			: [],
	);
	const resources = new Map<string, Uint8Array>();
	const remap = new Map<string, string>();
	const paths = new Map<string, string>();
	const icons = new Map<string, string>();
	let skipped = 0;
	const records = groups
		.flatMap((g) => g.data)
		.filter((resource) => {
			if (resource.path.startsWith("@/") || resource.isDelete) {
				skipped++;
				return false;
			}
			return true;
		});
	for (const item of records.filter((r) => r.resourceType !== "DeviceConfig")) {
		const bytes = files.get(archiveRelative(item.path, index.originalBasePath));
		if (!bytes) throw new BackupInvalid();
		const id = hashBytes(bytes);
		if (existingResources.has(id)) skipped++;
		else resources.set(id, bytes);
		remap.set(String(item.id), `backup-resource:${id}`);
		const mime =
			bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71
				? "image/png"
				: bytes[0] === 255 && bytes[1] === 216
					? "image/jpeg"
					: Buffer.from(bytes.subarray(0, 6)).toString() === "GIF89a" ||
							Buffer.from(bytes.subarray(0, 6)).toString() === "GIF87a"
						? "image/gif"
						: "";
		if (mime && bytes.length <= 1024 * 1024)
			icons.set(
				String(item.id),
				`data:${mime};base64,${Buffer.from(bytes).toString("base64")}`,
			);
		paths.set(item.path, `${destination}/backup-resources-v1/${id}`);
	}
	const rewrite = (value: ProfileJson): ProfileJson => {
		if (typeof value === "string") {
			if (paths.has(value)) return paths.get(value) ?? value;
			return portable.path(value);
		}
		if (Array.isArray(value)) return value.map(rewrite);
		if (value && typeof value === "object")
			return Object.fromEntries(
				Object.entries(value).map(([k, v]) => [
					k,
					(k === "icon" || k === "alterIcon") && icons.has(String(v))
						? (icons.get(String(v)) ?? v)
						: ([
									"icon",
									"alterIcon",
									"resourceId",
									"emojiVideoResId",
									"emojiGifResId",
								].includes(k) ||
									(k === "value" &&
										"type" in value &&
										value.type === "emojiFolderId")) &&
								remap.has(String(v))
							? (remap.get(String(v)) ?? v)
							: rewrite(v),
				]),
			);
		return value;
	};
	const profiles = [...envelope.profiles];
	const seenConfigs = new Set<string>();
	const comparableKey = Schema.Struct({
		keyCode: Schema.String,
		childrenName: Schema.optional(Schema.String),
		config: ProfileJsonObject,
	});
	const comparable = (keys: readonly unknown[]) =>
		keyFingerprint(
			keys.map((key) => Schema.decodeUnknownSync(comparableKey)(key)),
		);
	for (const profile of profiles) {
		const encoded = Schema.encodeSync(Profile)(profile);
		for (const page of encoded.pages)
			seenConfigs.add(
				comparable([...page.keys, ...(encoded.knob ? [encoded.knob] : [])]),
			);
	}
	const pending = new Map<
		string,
		{
			name: string;
			pages: { id: string; keys: (typeof ProfileKey.Encoded)[] }[];
			knob?: { keyCode: "0,1"; config: typeof ProfileJsonObject.Type };
			sourceId: string;
			fingerprints: string[];
		}
	>();
	// Identical repeated imports are skipped by source-content identity, independent of remapped paths.
	for (const resource of records.filter(
		(r) => r.resourceType === "DeviceConfig",
	)) {
		const raw = Schema.decodeUnknownSync(Schema.Array(ProfileJsonObject))(
			json(files.get(archiveRelative(resource.path, index.originalBasePath))),
		);
		const content = hashBytes(Buffer.from(stable(raw)));
		if (
			seenConfigs.has(comparable(raw)) ||
			profiles.some(
				(p) =>
					p.id === `import-${content}` ||
					Schema.encodeSync(Profile)(p)
						.compatibility?.pageFingerprints?.toString()
						.includes(content),
			) ||
			(isBuiltinProfile(String(resource.id)) &&
				builtinProfiles(index.originalPlatform).some((p) => {
					const encoded = Schema.encodeSync(Profile)(p);
					const sourceKeys =
						p.pages[0]?.keys.map(
							(k) => Schema.encodeSync(ProfileKey)(k).compatibility?.source,
						) ?? [];
					const exportedKeys =
						p.pages[0]?.keys.map((k) => Schema.encodeSync(ProfileKey)(k)) ?? [];
					return (
						p.id === String(resource.id) &&
						[sourceKeys, exportedKeys].some(
							(keys) =>
								keyFingerprint([
									...keys,
									...(encoded.knob ? [encoded.knob] : []),
								]) === keyFingerprint(raw),
						)
					);
				}))
		) {
			skipped++;
			continue;
		}
		seenConfigs.add(comparable(raw));
		const rewritten = Schema.decodeUnknownSync(Schema.Array(ProfileJsonObject))(
			rewrite(withoutCredentials(raw)),
		);
		const parts = resource.name.split(",");
		const group = parts.length >= 3 ? (parts[0] ?? resource.name) : content;
		const keySchema = Schema.Struct({
			keyCode: Schema.String,
			config: ProfileJsonObject,
			childrenName: Schema.optional(Schema.String),
		});
		const keys = rewritten.map((value) =>
			Schema.decodeUnknownSync(keySchema)(value),
		);
		const pageKeys = keys
			.filter((k) => k.keyCode !== "0,1")
			.map((k) =>
				Schema.encodeSync(ProfileKey)(
					Schema.decodeUnknownSync(ProfileKey)({
						...k,
						compatibility: { unsupported: !k.childrenName, source: k },
					}),
				),
			);
		const knob = keys.find((k) => k.keyCode === "0,1");
		const existing = pending.get(group);
		const page = { id: parts[1] ?? "1", keys: pageKeys };
		if (existing) {
			existing.pages.push(page);
			existing.fingerprints.push(content);
		} else
			pending.set(group, {
				name:
					profileNames.get(String(resource.id)) ||
					(parts.length >= 3 ? `Imported ${group}` : resource.name),
				pages: [page],
				sourceId: content,
				fingerprints: [content],
				...(knob ? { knob: { keyCode: "0,1", config: knob.config } } : {}),
			});
	}
	for (const item of pending.values()) {
		// Stable original content identity makes repeated imports idempotent.
		if (profiles.some((p) => p.id === `import-${item.sourceId}`)) {
			skipped++;
			continue;
		}
		profiles.push(
			Schema.decodeUnknownSync(Profile)({
				id: `import-${item.sourceId}`,
				name: item.name,
				revision: 0,
				pages: item.pages,
				...(item.knob ? { knob: item.knob } : {}),
				compatibility: {
					imported: true,
					sourceFingerprint: item.sourceId,
					pageFingerprints: item.fingerprints,
				},
			}),
		);
	}
	return {
		envelope: encodeProfileEnvelope({
			...envelope,
			profiles: Schema.decodeUnknownSync(ProfileEnvelope)({
				...encodeProfileEnvelope(envelope),
				profiles: profiles.map((p) => Schema.encodeSync(Profile)(p)),
			}).profiles,
		}),
		resources,
		legacyFiles: portable.legacyFiles,
		imported: pending.size + resources.size,
		skipped,
	};
}
export function backupProjection(
	envelope: unknown,
	base: string,
	platform: string,
	assets: readonly {
		readonly source: string;
		readonly bytes: Uint8Array;
	}[] = [],
): Map<string, Uint8Array> {
	const current = Schema.decodeUnknownSync(ProfileEnvelope)(envelope);
	const files = new Map<string, Uint8Array>();
	const jsonBytes = (value: unknown) => Buffer.from(JSON.stringify(value));
	const assetPaths = new Map<string, string>();
	const resourceRows = assets.map(({ source, bytes }) => {
		const id = hashBytes(bytes);
		const relative = `app/assets/resource/${id}`;
		files.set(relative, bytes);
		assetPaths.set(source.replaceAll("\\", "/"), `${base}/${relative}`);
		return {
			id: `backup-resource:${id}`,
			name: id,
			path: `${base}/${relative}`,
			resourceType: "File",
		};
	});
	const projectPaths = (value: ProfileJson): ProfileJson => {
		if (typeof value === "string")
			return assetPaths.get(value.replaceAll("\\", "/")) ?? value;
		if (Array.isArray(value)) return value.map(projectPaths);
		if (value && typeof value === "object")
			return Object.fromEntries(
				Object.entries(value).map(([key, item]) => [key, projectPaths(item)]),
			);
		return value;
	};
	const data = current.profiles.flatMap((profile, index) =>
		profile.pages.map((page, pageIndex) => {
			const id = pageIndex === 0 ? profile.id : `${profile.id}-${page.id}`;
			const relative = `app/assets/config/${id}.json`;
			const encoded = Schema.encodeSync(Profile)(profile);
			const keys = [
				...page.keys.map((k) => Schema.encodeSync(ProfileKey)(k)),
				...(encoded.knob ? [encoded.knob] : []),
			];
			files.set(
				relative,
				jsonBytes(
					projectPaths(
						withoutCredentials(Schema.decodeUnknownSync(ProfileJson)(keys)),
					),
				),
			);
			return {
				id,
				name: `${index + 1},${pageIndex + 1},1`,
				path: `${base}/${relative}`,
				resourceType: "DeviceConfig",
			};
		}),
	);
	files.set(
		"app/assets/resources.conf",
		jsonBytes([{ data: [...data, ...resourceRows] }]),
	);
	files.set(
		"default_config.json",
		encodeAccountConfig(
			{
				quakeConfig: {
					deviceMenuProfile: current.profiles.map((p) => ({
						resourceId: p.id,
						title: p.name,
					})),
				},
			},
			"default",
		),
	);
	files.set(
		"export_index.json",
		jsonBytes({ originalBasePath: base, originalPlatform: platform }),
	);
	return files;
}
