/**
 * Independently authored compatibility examples. No recovered implementation or assets copied.
 * Locale sentinels use observed data from en.json and zh.json under
 * /Users/ramarivera/dev/open-quake/.context/decokee-quake-template/src/locales/
 * Behavioral sources, read-only in the main checkout:
 * /Users/ramarivera/dev/open-quake/.agents/skills/dark-encyclopedia/dk-suite-introspeccion/artifacts/recovered_sources/webpack:__dk-suite_src_plugins_KeyConfiguration.js
 * /Users/ramarivera/dev/open-quake/.agents/skills/dark-encyclopedia/dk-suite-introspeccion/artifacts/recovered_sources/webpack:__dk-suite_src_plugins_hotKeyFun.js
 * /Users/ramarivera/dev/open-quake/.agents/skills/dark-encyclopedia/dk-suite-introspeccion/artifacts/recovered_sources/webpack:__dk-suite_src_views_Components_config_OperationConfig.vue
 */
export const tile = (id: string, config: Record<string, unknown>) => ({
	keyCode: "1,3",
	childrenName: id,
	config: {
		title: { text: "Independent fixture" },
		icon: "local:fixture",
		gap: 23,
		pressTime: 17,
		...config,
	},
});
export const nextTrackFixture = tile("skipForward", {
	type: "skipBackward",
	actions: [{ type: "key", value: "audio_next" }],
});
export const previousTrackFixture = tile("skipBackward", {
	type: "skipBackward",
	actions: [{ type: "key", value: "audio_prev" }],
});
export const switchFixture = tile("hotkeySwitch", {
	type: "hotkeySwitch",
	actions: [
		{ type: "key", value: "control+a" },
		{ type: "key", value: "control+b" },
	],
	alterTitle: { text: "Second" },
	alterIcon: "local:alternate",
});
export const textSentinelFixture = tile("text", {
	type: "text",
	actions: [{ type: "text", value: "Line one\nline two" }, {}],
});
