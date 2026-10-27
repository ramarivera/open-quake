import { Option, Schema } from "effect";
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
import {
	managerState,
	PROFILE_LIMIT,
} from "../../../../../packages/device/src/profiles/profile-manager-invariants.js";
import { BackupInvalid } from "../../../../../packages/edge/src/maintenance/maintenance-errors.js";
import { ClockRecord } from "../clock/clock-store";
import {
	legacyClockConfiguration,
	migrateProfileClocks,
} from "../profiles/clock-migration";
import { decodeAccountConfig, encodeAccountConfig } from "./account-config";
import {
	type ArchiveFiles,
	ExportIndex,
	safeArchivePath,
} from "./backup-archive";
import { backupPaths } from "./backup-paths";
import { mergeProfileLinks } from "./backup-profile-links";
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
const isConfigObject = (
	value: ProfileJson,
): value is typeof ProfileJsonObject.Type =>
	value !== null && typeof value === "object" && !Array.isArray(value);
// Preserve legacy-only configuration fields while current editable values take precedence.
const resolvedConfig = (
	source: ProfileJson,
	current: ProfileJson,
): ProfileJson => {
	if (isConfigObject(source) && isConfigObject(current))
		return {
			...source,
			...Object.fromEntries(
				Object.entries(current).map(([name, value]) => [
					name,
					resolvedConfig(source[name] ?? null, value),
				]),
			),
		};
	return current;
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
const assertCapacity = (
	current: ProfileEnvelope,
	profiles: readonly Profile[],
): void => {
	const hidden = managerState(current).hidden;
	if (
		profiles.filter((profile) => !hidden.includes(profile.id)).length >
		PROFILE_LIMIT
	)
		throw new BackupInvalid();
};

export interface BackupMerge {
	readonly profileIds?: ReadonlyMap<string, string>;
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
		let imported = Schema.decodeUnknownSync(ProfileEnvelope)(
			portable.rewrite(
				withoutCredentials(Schema.decodeUnknownSync(ProfileJson)(json(native))),
			),
		);
		if (imported.clockConfigVersion !== 1) {
			const legacy = legacyClockConfiguration(
				new Map(
					[...files]
						.filter(
							([name]) =>
								name === "open-quake/clock-v1/clock.json" ||
								name.startsWith("open-quake/wallpaper-v1/settings/"),
						)
						.map(([name, bytes]) => [
							name.slice("open-quake/".length),
							Buffer.from(bytes).toString("utf8"),
						]),
				),
			);
			const clock = legacy.clock
				? Schema.decodeUnknownSync(ClockRecord, {
						onExcessProperty: "preserve",
					})(
						portable.rewrite(
							Schema.decodeUnknownSync(ProfileJson)(legacy.clock),
						),
					)
				: undefined;
			imported = Schema.decodeUnknownSync(ProfileEnvelope)(
				migrateProfileClocks(encodeProfileEnvelope(imported), {
					...legacy,
					clock,
				}),
			);
		}

		const profiles = [...envelope.profiles];
		const profileIds = new Map<string, string>();
		let skipped = 0;
		let added = 0;
		for (const profile of imported.profiles) {
			const encoded = Schema.encodeSync(Profile)(profile);
			const fingerprint = hashBytes(
				Buffer.from(stable({ pages: encoded.pages, knob: encoded.knob })),
			);
			const duplicate = profiles.find((p) => {
				const existing = Schema.encodeSync(Profile)(p);
				return (
					hashBytes(
						Buffer.from(stable({ pages: existing.pages, knob: existing.knob })),
					) === fingerprint
				);
			});
			if (duplicate) {
				profileIds.set(profile.id, duplicate.id);
				skipped++;
				continue;
			}
			const base = `import-${fingerprint}`;
			let id = base;
			let suffix = 1;
			while (profiles.some((p) => p.id === id)) id = `${base}-${suffix++}`;
			profiles.push(
				Schema.decodeUnknownSync(Profile)({ ...encoded, id, revision: 0 }),
			);
			profileIds.set(profile.id, id);
			added++;
		}
		assertCapacity(envelope, profiles);
		return {
			envelope: encodeProfileEnvelope({
				...envelope,
				manager: mergeProfileLinks(
					envelope,
					imported,
					profileIds,
					index.originalPlatform,
				),
				profiles: Schema.decodeUnknownSync(ProfileEnvelope)({
					...encodeProfileEnvelope(envelope),
					profiles: profiles.map((p) => Schema.encodeSync(Profile)(p)),
				}).profiles,
			}),
			resources: new Map(),
			profileIds,
			legacyFiles: portable.legacyFiles,
			imported: added,
			skipped,
		};
	}
	const groups = Schema.decodeUnknownSync(ResourceGroups, {
		onExcessProperty: "preserve",
	})(json(files.get("app/assets/resources.conf")));
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
	const comparableKey = Schema.Struct({
		keyCode: Schema.String,
		childrenName: Schema.optional(Schema.String),
		config: ProfileJsonObject,
	});
	const comparable = (keys: readonly unknown[]) =>
		keyFingerprint(
			keys.map((key) => {
				const current = Schema.decodeUnknownSync(comparableKey)(key);
				const legacy = Schema.decodeUnknownEither(
					Schema.Struct({
						compatibility: Schema.Struct({
							source: Schema.Struct({ config: ProfileJsonObject }),
						}),
					}),
				)(key);
				return {
					...current,
					config:
						legacy._tag === "Right"
							? resolvedConfig(
									legacy.right.compatibility.source.config,
									current.config,
								)
							: current.config,
				};
			}),
		);
	const fingerprint = (profile: typeof Profile.Encoded) =>
		hashBytes(
			Buffer.from(
				stable({
					pages: profile.pages.map((page) => comparable(page.keys)),
					knob: profile.knob ? comparable([profile.knob]) : null,
				}),
			),
		);
	const seenProfiles = new Set(
		profiles.map((profile) => fingerprint(Schema.encodeSync(Profile)(profile))),
	);
	const pending = new Map<
		string,
		{
			name: string;
			pages: {
				id: string;
				keys: (typeof ProfileKey.Encoded)[];
				compatibility?: typeof ProfileJsonObject.Type;
			}[];
			knob?: { keyCode: "0,1"; config: typeof ProfileJsonObject.Type };
			unchangedBuiltin: boolean;
		}
	>();
	// Assemble every page before deduplication. A matching page never removes part of a profile.
	for (const resource of records.filter(
		(r) => r.resourceType === "DeviceConfig",
	)) {
		const raw = Schema.decodeUnknownSync(Schema.Array(ProfileJsonObject))(
			json(files.get(archiveRelative(resource.path, index.originalBasePath))),
		);
		const rewritten = Schema.decodeUnknownSync(Schema.Array(ProfileJsonObject))(
			rewrite(withoutCredentials(raw)),
		);
		const parts = resource.name.split(",");
		const group =
			parts.length >= 3 ? `group:${parts[0]}` : `resource:${resource.id}`;
		const keys = rewritten.map((value) =>
			Schema.decodeUnknownSync(comparableKey)(value),
		);
		const pageKeys = keys
			.filter((key) => key.keyCode !== "0,1")
			.map((key) => {
				const { childrenName, ...fields } = key;
				return Schema.encodeSync(ProfileKey)(
					Schema.decodeUnknownSync(ProfileKey)({
						...fields,
						...(childrenName ? { childrenName } : {}),
						compatibility: { unsupported: !childrenName, source: key },
					}),
				);
			});
		const knob = keys.find((key) => key.keyCode === "0,1");
		const page = {
			id: parts[1] ?? "1",
			keys: pageKeys,
			compatibility: {
				backupResource: rewrite(
					withoutCredentials(Schema.decodeUnknownSync(ProfileJson)(resource)),
				),
			},
		};
		const existing = pending.get(group);
		if (existing) {
			existing.pages.push(page);
			existing.unchangedBuiltin = false;
		} else {
			const unchangedBuiltin =
				isBuiltinProfile(String(resource.id)) &&
				builtinProfiles(index.originalPlatform).some((profile) => {
					const encoded = Schema.encodeSync(Profile)(profile);
					const sourceKeys =
						profile.pages[0]?.keys.map(
							(key) => Schema.encodeSync(ProfileKey)(key).compatibility?.source,
						) ?? [];
					const exportedKeys =
						profile.pages[0]?.keys.map((key) =>
							Schema.encodeSync(ProfileKey)(key),
						) ?? [];
					return (
						profile.id === String(resource.id) &&
						[sourceKeys, exportedKeys].some(
							(items) =>
								keyFingerprint([
									...items,
									...(encoded.knob ? [encoded.knob] : []),
								]) === keyFingerprint(raw),
						)
					);
				});
			pending.set(group, {
				name:
					profileNames.get(String(resource.id)) ||
					(parts.length >= 3 ? `Imported ${parts[0]}` : resource.name),
				pages: [page],
				unchangedBuiltin,
				...(knob ? { knob: { keyCode: "0,1", config: knob.config } } : {}),
			});
		}
	}
	let added = 0;
	for (const item of pending.values()) {
		const draft = {
			id: "import",
			name: item.name,
			revision: 0,
			pages: item.pages,
			...(item.knob ? { knob: item.knob } : {}),
		};
		// Resolved configs include content-addressed files, folders, resource IDs and inline icons.
		const content = fingerprint(
			Schema.encodeSync(Profile)(Schema.decodeUnknownSync(Profile)(draft)),
		);
		if (item.unchangedBuiltin || seenProfiles.has(content)) {
			skipped++;
			continue;
		}
		const base = `import-${content}`;
		let id = base;
		let suffix = 1;
		while (profiles.some((profile) => profile.id === id))
			id = `${base}-${suffix++}`;
		profiles.push(
			Schema.decodeUnknownSync(Profile)({
				...draft,
				id,
				compatibility: { imported: true, sourceFingerprint: content },
			}),
		);
		seenProfiles.add(content);
		added++;
	}
	// Keep the original taxonomy and extra metadata in existing legacy storage.
	// The payload uses owned rewritten paths and content IDs, never source paths.
	const catalog = rewrite(
		withoutCredentials(
			Schema.decodeUnknownSync(ProfileJson)([{ data: records }]),
		),
	);
	const catalogBytes = Buffer.from(JSON.stringify(catalog));
	portable.legacyFiles.set(
		`resource-catalog-${hashBytes(catalogBytes)}/resources.json`,
		catalogBytes,
	);
	assertCapacity(envelope, profiles);
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
		imported: added + resources.size,
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
	files: Map<string, Uint8Array> = new Map(),
): Map<string, Uint8Array> {
	const current = Schema.decodeUnknownSync(ProfileEnvelope)(envelope);
	const jsonBytes = (value: unknown) => Buffer.from(JSON.stringify(value));
	const assetPaths = new Map<string, string>();
	const metadata = assets
		.filter((asset) =>
			/\/resource-catalog-[a-f0-9]{64}\/resources\.json$/.test(asset.source),
		)
		.flatMap(({ bytes }) =>
			Schema.decodeUnknownSync(ResourceGroups, {
				onExcessProperty: "preserve",
			})(json(bytes)).flatMap((group) => group.data),
		);
	const resourceRows = assets
		.filter(
			(asset) =>
				!/\/resource-catalog-[a-f0-9]{64}\/resources\.json$/.test(asset.source),
		)
		.flatMap(({ source, bytes }) => {
			const id = hashBytes(bytes);
			const relative = `app/assets/resource/${id}`;
			files.set(relative, bytes);
			assetPaths.set(source.replaceAll("\\", "/"), `${base}/${relative}`);
			const retained = [
				...new Map(
					metadata
						.filter(
							(entry) =>
								entry.path.replaceAll("\\", "/") ===
								source.replaceAll("\\", "/"),
						)
						.map((entry) => [stable(entry), entry]),
				).values(),
			];
			return (retained.length ? retained : [undefined]).map((entry) => ({
				...entry,
				id: `backup-resource:${id}`,
				name: entry?.name ?? id,
				path: `${base}/${relative}`,
				resourceType: entry?.resourceType ?? "File",
			}));
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
			const retained =
				Option.isSome(page.compatibility) &&
				Schema.is(ProfileJsonObject)(page.compatibility.value.backupResource)
					? page.compatibility.value.backupResource
					: {};
			return {
				...retained,
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
