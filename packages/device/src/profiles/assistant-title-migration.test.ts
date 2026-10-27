import { Effect, Layer, Option, Schema } from "effect";
import { expect, it } from "vitest";
import copilot from "./builtins/default_ai_copilot_chat_config.json";
import { upgradeAssistantTitle } from "./profile-assistant-migration.js";
import { ProfileEnvelope, ProfileKey } from "./profile-contracts.js";
import { inspectProfileImport } from "./profile-import.js";
import { ProfileRepository, ProfileStorage } from "./profile-repository.js";

it("AI-117 MGMT-358/359 SETTINGS-110 imports all six title repairs without changing prompts, titles or other locks", () => {
	for (const raw of copilot.filter((k) => k.config.type === "aiChat")) {
		const config = {
			...raw.config,
			title: { ...raw.config.title, text: "My title" },
			basicEditableItems: { ...raw.config.basicEditableItems, title: false },
		};
		const before = { ...raw, config };
		const after = upgradeAssistantTitle(before);
		expect(after.config).toEqual({
			...config,
			basicEditableItems: { ...config.basicEditableItems, title: true },
		});
		expect(upgradeAssistantTitle(after)).toBe(after);
		const decoded = Schema.decodeUnknownSync(ProfileKey)(before);
		expect(upgradeAssistantTitle(decoded).config.basicEditableItems).toEqual(
			Option.some({ ...config.basicEditableItems, title: true }),
		);
		expect(
			upgradeAssistantTitle({ ...before, config: { ...config, type: "other" } })
				.config,
		).toEqual({ ...config, type: "other" });
	}
	const source = copilot.find((k) => k.config.type === "aiChat");
	expect(source).toBeDefined();
	if (!source) return;
	const unknown = {
		...source,
		config: {
			...source.config,
			title: { ...source.config.title, i18nKey: "other" },
			actions: [{ type: "roleConfig", value: { roleId: 1 } }],
			basicEditableItems: { title: false },
		},
	};
	expect(upgradeAssistantTitle(unknown)).toBe(unknown);
});

it("SETTINGS-110 upgrades persisted profiles once on the real repository read path", async () => {
	const raw = copilot
		.filter((k) => k.config.type === "aiChat")
		.map((k) => ({
			...k,
			config: {
				...k.config,
				basicEditableItems: { ...k.config.basicEditableItems, title: false },
			},
		}));
	const imported = inspectProfileImport(raw);
	expect(imported.profile).toBeDefined();
	const encoded = {
		schemaVersion: 1,
		profiles: [
			{
				...imported.profile,
				id: "roles",
				pages: [{ id: "roles-page", keys: raw }],
			},
		],
		activeByDevice: {},
	};
	const envelope = Schema.decodeUnknownSync(ProfileEnvelope)(encoded);
	let writes = 0;
	await Effect.runPromise(
		Effect.gen(function* () {
			const repo = yield* ProfileRepository;
			const first = yield* repo.load();
			const second = yield* repo.load();
			expect(first.envelope).toBe(second.envelope);
			expect(
				first.envelope.profiles[0]?.pages[0]?.keys.every(
					(k) =>
						Option.isSome(k.config.basicEditableItems) &&
						k.config.basicEditableItems.value.title,
				),
			).toBe(true);
		}).pipe(
			Effect.provide(
				ProfileRepository.Default.pipe(
					Layer.provide(
						Layer.succeed(ProfileStorage, {
							read: async () => Schema.encodeSync(ProfileEnvelope)(envelope),
							write: async () => {
								writes++;
							},
						}),
					),
				),
			),
		),
	);
	expect(writes).toBe(1);
});
