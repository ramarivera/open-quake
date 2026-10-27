import { describe, expect, it } from "@effect/vitest";
import { Either, FastCheck, Option, Schema } from "effect";
import {
	ACTION_REGISTRY,
	ActionErrors,
	actionAvailability,
	createActionDraft,
	findAction,
	HOTKEY_MODIFIERS,
	isHotkeyChord,
	normalizeActionImport,
	normalizeWebsiteUrl,
	RETAINED_ACTION_OWNERS,
	retainedActionOwner,
	TextConfig,
	validateAction,
} from "../../src/actions/index.js";
import {
	nextTrackFixture,
	previousTrackFixture,
	switchFixture,
	textSentinelFixture,
	tile,
} from "./action-fixtures.js";

const valid = (
	id: string,
	actions: unknown,
	more: Record<string, unknown> = {},
) => validateAction(id, { type: id, actions, ...more });
const accepted = (id: string, value: string, type = "key") =>
	valid(id, [{ type, value }]);
const noAdapters = {
	keyboard: Option.none(),
	text: Option.none(),
	website: Option.none(),
	application: Option.none(),
	media: Option.none(),
};

describe("action registry and executable contracts", () => {
	it("has one declaration with explicit capability and policy for each entry", () => {
		expect(new Set(ACTION_REGISTRY.map((e) => e.id)).size).toBe(
			ACTION_REGISTRY.length,
		);
		for (const entry of ACTION_REGISTRY) {
			expect(entry.requiredAdapter.length).toBeGreaterThan(0);
			expect(entry.autonomy).toBe("never");
			expect(["read", "sensitive", "write"]).toContain(entry.permission);
			expect(typeof entry.supportKnob).toBe("boolean");
			expect(typeof entry.supportTouchEffect).toBe("boolean");
			expect(entry.legacyNames).toContain(entry.id);
			expect(entry.configTypeAliases).toBeDefined();
			expect(entry.inputSchema).toBeDefined();
			expect(actionAvailability(entry, noAdapters)).not.toBe("available");
		}
		expect(findAction("previousPage")?.configTypeAliases).toEqual(["pageUp"]);
		for (const policy of Object.values(ActionErrors))
			expect(policy.policy.retry).toBe("manual");
	});
	it("clones draft templates and defaults text to no enter", () => {
		const first = createActionDraft("text");
		const second = createActionDraft("text");
		expect(first.actions).toEqual([{ type: "text", value: "" }]);
		expect(first.actions).not.toBe(second.actions);
		first.actions = [{ type: "text", value: "private edit" }];
		expect(second.actions).toEqual([{ type: "text", value: "" }]);
		expect(Either.isLeft(validateAction("text", second))).toBe(true);
	});
	it("enforces exact leaf shapes, URL schemes and action ordering", () => {
		for (const url of [
			"javascript:alert(1)",
			"file:///tmp/private",
			"https:",
			"https:example.org",
			"",
			"not a URL",
		])
			expect(Either.isLeft(accepted("website", url, "url"))).toBe(true);
		expect(
			Either.isRight(
				accepted("website", "https://example.org/path?q=1", "url"),
			),
		).toBe(true);
		expect(
			Either.isLeft(
				valid("text", [
					{ type: "key", value: "enter" },
					{ type: "text", value: "x" },
				]),
			),
		).toBe(true);
		expect(
			Either.isLeft(
				valid("website", [
					{ type: "url", value: "https://example.org" },
					{ type: "key", value: "enter" },
				]),
			),
		).toBe(true);
		expect(
			Either.isLeft(
				valid("text", [{ type: "text", value: "x" }], { supportKnob: true }),
			),
		).toBe(true);
		for (const value of [
			"",
			"control",
			"Control+a",
			"control+control+a",
			"a+b",
			"control+a+b",
			"Please enter hotkeys for matching",
			"unknown_key",
		])
			expect(Either.isLeft(accepted("hotkey", value))).toBe(true);
		expect(
			Either.isRight(accepted("hotkey", "right_control+right_shift+a")),
		).toBe(true);
		expect(
			Either.isLeft(
				valid("hotkey", [
					{ type: "key", value: "a" },
					{ type: "key", value: "b" },
				]),
			),
		).toBe(true);
		expect(
			Either.isRight(
				valid(
					"hotkey",
					[
						{ type: "key", value: "a" },
						{ type: "key", value: "b" },
					],
					{ supportKnob: true },
				),
			),
		).toBe(true);
	});

	it("accepts absolute application paths and selected references, rejecting relative targets", () => {
		for (const value of [
			"/Applications/Independent Fixture.app",
			"/usr/bin/editor",
			"C:\\Program Files\\Editor\\Editor.exe",
			"C:/Program Files/Editor/Editor.exe",
			"\\\\server\\apps\\Editor.exe",
			"app:org.example.Editor",
		])
			expect(Either.isRight(accepted("open", value, "path")), value).toBe(true);
		for (const value of [
			"",
			"  ",
			"./Editor",
			"../Editor",
			"Editor",
			"~/Applications/Editor.app",
			"C:Editor.exe",
			"\\Editor.exe",
			"app:",
			"app:org..Editor",
			"app:org.example/Editor",
			"app:org.example.Editor --flag",
			"/Applications/Editor.app\0",
		])
			expect(Either.isLeft(accepted("open", value, "path")), value).toBe(true);
	});

	it("validates profile, knob and clock integration payloads without dispatch", () => {
		for (const [id, validConfig, invalidConfig] of [
			[
				"goToPage",
				{ type: "goToPage", actions: [{ type: "page", value: 1 }] },
				{ type: "goToPage", actions: [{ type: "page", value: 0 }] },
			],
			[
				"previousPage",
				{ type: "previousPage", actions: [] },
				{ type: "previousPage", actions: [{ type: "page", value: 1 }] },
			],
			[
				"nextPage",
				{ type: "nextPage", actions: [] },
				{ type: "nextPage", actions: [{ type: "page", value: 1 }] },
			],
			[
				"panelBrightness",
				{
					type: "panelBrightness",
					actions: [{ type: "stepPercent", value: 5 }],
				},
				{
					type: "panelBrightness",
					actions: [{ type: "stepPercent", value: 101 }],
				},
			],
			[
				"dkDesktopClock",
				{
					type: "dkDesktopClock",
					actions: [{ type: "hourFormat", value: "24h" }],
				},
				{
					type: "dkDesktopClock",
					actions: [{ type: "hourFormat", value: "unknown" }],
				},
			],
			[
				"assistant",
				{
					type: "assistant",
					actions: [
						{ type: "directModel", value: "model-ref" },
						{ type: "voiceRoute", value: "direct" },
						{ type: "directProvider", value: "provider-ref" },
					],
				},
				{
					type: "assistant",
					actions: [
						{ type: "voiceRoute", value: "direct" },
						{ type: "directModel", value: "model-ref" },
						{ type: "directModel", value: "duplicate" },
					],
				},
			],
		] as const) {
			expect(Either.isRight(validateAction(id, validConfig))).toBe(true);
			expect(Either.isLeft(validateAction(id, invalidConfig))).toBe(true);
		}
	});
	it("counts Unicode code points and round trips valid text", () => {
		expect(Either.isRight(accepted("text", "😀".repeat(500), "text"))).toBe(
			true,
		);
		expect(Either.isLeft(accepted("text", "😀".repeat(501), "text"))).toBe(
			true,
		);
		FastCheck.assert(
			FastCheck.property(
				FastCheck.string({ minLength: 1, maxLength: 500 }),
				(value) => {
					const config = { type: "text", actions: [{ type: "text", value }] };
					expect(
						Schema.encodeSync(TextConfig)(
							Schema.decodeUnknownSync(TextConfig)(config),
						),
					).toEqual(config);
				},
			),
		);
	});
	it("accepts distinct supported modifiers and rejects duplicate tokens", () => {
		FastCheck.assert(
			FastCheck.property(
				FastCheck.subarray([...HOTKEY_MODIFIERS]),
				(modifiers) => {
					expect(isHotkeyChord([...modifiers, "a"].join("+"))).toBe(true);
					if (modifiers.length > 0)
						expect(
							isHotkeyChord([...modifiers, ...modifiers, "a"].join("+")),
						).toBe(false);
				},
			),
		);
	});
	it("requires every media ID to agree with its exact command", () => {
		for (const entry of ACTION_REGISTRY) {
			if (!("mediaCommand" in entry)) continue;
			expect(Either.isRight(accepted(entry.id, entry.mediaCommand))).toBe(true);
			expect(Either.isLeft(accepted(entry.id, "audio_invalid"))).toBe(true);
			expect(
				actionAvailability(entry, {
					...noAdapters,
					media: Option.some({
						supportedCommands: new Set([entry.mediaCommand]),
						sendMedia: () => {
							throw new Error("must never execute while checking availability");
						},
					}),
				}),
			).toBe("available");
		}
	});
});

describe("narrow DK-Suite import normalization", () => {
	it("fixes only the corroborated next-track defect and keeps originals independent", () => {
		const source = structuredClone(nextTrackFixture);
		const result = normalizeActionImport(source);
		expect(result.normalized).toEqual({
			...source,
			config: { ...source.config, type: "skipForward" },
		});
		expect(result.original).toEqual(source);
		expect(result.original).not.toBe(source);
		expect(result.normalized).not.toBe(source);
		expect(source).toEqual(nextTrackFixture);
		expect(result.diagnostics).toEqual(["next-track-type"]);
		for (const source of [
			previousTrackFixture,
			switchFixture,
			tile("skipForward", {
				type: "skipBackward",
				actions: [{ type: "key", value: "audio_prev" }],
			}),
			tile("unknown", {
				type: "skipBackward",
				actions: [{ type: "key", value: "audio_next" }],
			}),
		])
			expect(normalizeActionImport(source).normalized).toEqual(source);
	});
	it("normalizes exact locale prompts only in plain hotkeys, leaving incomplete drafts inert", () => {
		const placeholders = [
			"Please enter hotkeys for matching",
			"Observing the typed keys...",
			"请输入热键进行匹配",
			"正在观察键入的按键...",
		];
		for (const value of placeholders) {
			const source = tile("hotkey", {
				type: "hotkey",
				actions: [{ type: "key", value }],
			});
			const result = normalizeActionImport(source);
			expect(result.normalized).toEqual({
				...source,
				config: { ...source.config, actions: [{ type: "key", value: "" }] },
			});
			expect(result.original).toEqual(source);
			expect(result.diagnostics).toEqual([
				"hotkey-placeholder",
				"unsupported-or-incomplete",
			]);
		}
		const source = tile("hotkey", {
			type: "hotkey",
			actions: [{ type: "key", value: "unknown localized prompt" }],
		});
		expect(normalizeActionImport(source).normalized).toEqual(source);
		expect(
			normalizeActionImport(switchFixture, {
				localizedPlaceholders: ["control+a"],
			}).normalized,
		).toEqual(switchFixture);
	});
	it("removes only the empty trailing text-enter object and preserves timing/artwork", () => {
		const result = normalizeActionImport(textSentinelFixture);
		expect(result.normalized).toEqual({
			...textSentinelFixture,
			config: {
				...textSentinelFixture.config,
				actions: [{ type: "text", value: "Line one\nline two" }],
			},
		});
		expect(result.original).toEqual(textSentinelFixture);
		for (const actions of [
			[
				{ type: "text", value: "x" },
				{ type: "key", value: "enter" },
			],
			[{ type: "text", value: "x" }, { value: "" }],
			[{}, { type: "text", value: "x" }],
		]) {
			const source = tile("text", { type: "text", actions });
			expect(normalizeActionImport(source).normalized).toEqual(source);
		}
	});
	it("is idempotent and never mutates unknown compatibility data", () => {
		FastCheck.assert(
			FastCheck.property(FastCheck.jsonValue(), (input) => {
				const result = normalizeActionImport(input);
				expect(result.original).toEqual(input);
				expect(normalizeActionImport(result.normalized).normalized).toEqual(
					result.normalized,
				);
			}),
		);
		for (const source of [
			nextTrackFixture,
			previousTrackFixture,
			textSentinelFixture,
			switchFixture,
		]) {
			const result = normalizeActionImport(source);
			expect(normalizeActionImport(result.normalized).normalized).toEqual(
				result.normalized,
			);
		}
	});
});

it("MAIN-072: safe title templates normalize at the import boundary without evaluation", () => {
	for (const template of [
		"example.org/{title}",
		"example.org/{{title}}",
		"example.org/${title}",
	]) {
		const normalized = normalizeActionImport({
			childrenName: "website",
			config: {
				type: "website",
				title: { text: "hello" },
				actions: [{ type: "url", value: template }],
			},
		});
		expect(normalized.normalized).toMatchObject({
			config: { actions: [{ type: "url", value: "http://example.org/hello" }] },
		});
		expect(normalized.diagnostics).toEqual(["website-normalized"]);
	}
	for (const value of [
		"javascript:alert(1)",
		"file:///private",
		"data:text/html,hi",
		" http://example.org",
		"https://example.org/\n",
	])
		expect(normalizeWebsiteUrl(value, "hello")).toBeUndefined();
	expect(normalizeWebsiteUrl("https://example.org/{title}", "${1+1}")).toBe(
		"https://example.org/${1+1}",
	);
});

it("MAIN-066: all 76 retained native types have their canonical owner; plugin dispatch stays a separate port", () => {
	const retained =
		"timer brightness multiActions delay folder emojiFolder back emojiBack switchProfile pageUp pageDown goToPage pageNo website hotkeySwitch hotkey open close text media mute playPause stopPlay skipBackward skipForward fastBackward fastForward repeatPlay randomPlay vol playAudio playAudioLegacy stopAudio knob assistant cmd homeAssistant obsScene obsPreviewScene obsTransition obsStudioMode obsStream obsRecord obsSource obsMute obsCut obsTransitionSet obsAudioMonitor obsReplayBuffer obsVirtualCam obsMedia obsFilter obsProfile obsRecordSplit obsSceneTransitionOverride obsVolume luminance buzzer mic meetingMinutes tempMeetingMinutes meetingRecordMark cpuInfo gpuInfo memInfo diskInfo processInfo networkInfo bluetoothInfo powerInfo emoji liveAudioTranslate aiChat aiChatView audioBot clawbot".split(
			" ",
		);
	expect(retained).toHaveLength(76);
	expect(Object.keys(RETAINED_ACTION_OWNERS).sort()).toEqual(
		[...retained].sort(),
	);
	for (const type of retained) expect(retainedActionOwner(type)).toBeDefined();
	expect(retainedActionOwner("plugin.example")).toBeUndefined();
	expect(retainedActionOwner("assistant")).toBe("voice");
	expect(retainedActionOwner("clawbot")).toBe("agents");
});

it.each([
	["localhost:3000/{title}", "http://localhost:3000/hello"],
	["example.org:8080/{{title}}", "http://example.org:8080/hello"],
	["127.0.0.1:8080/path", "http://127.0.0.1:8080/path"],
	["localhost:65536/path", undefined],
	["example.org:invalid/path", undefined],
	["javascript:3000/path", undefined],
	["data:8080/path", undefined],
	["file:8080/path", undefined],
	["https:3000/path", undefined],
])(
	"PR127: validates host ports without allowing unsafe schemes %s",
	(value, expected) => {
		expect(normalizeWebsiteUrl(value, "hello")).toBe(expected);
	},
);
