import type { ManagementPage } from "../management/navigation";

/**
 * The bundled QUAKE guide (settings-and-wizard 3.2). Structure lives here and
 * every sentence lives in strings.json under `settings.guide`, so the guide is
 * readable offline in each bundled language. Copy describes current open-quake
 * behavior only; it must not promise hardware acceptance or bundled services.
 */
export const GUIDE_TOPICS = [
	"start",
	"keys",
	"knob",
	"voice",
	"places",
	"limits",
] as const;
export type GuideTopic = (typeof GUIDE_TOPICS)[number];

/** Dictionary keys are relative to `guide.topics.<topic>.`. */
export type GuideBlock =
	| { readonly kind: "text"; readonly key: string }
	| {
			readonly kind: "list";
			readonly heading: string;
			readonly items: ReadonlyArray<string>;
	  }
	| {
			readonly kind: "terms";
			readonly items: ReadonlyArray<{
				readonly term: string;
				readonly detail: string;
			}>;
	  }
	| {
			readonly kind: "note";
			readonly key: string;
			readonly tone: "info" | "warning";
	  }
	| { readonly kind: "places" };

const term = (id: string) => ({ term: `${id}.term`, detail: `${id}.detail` });

export const GUIDE_CONTENT: Readonly<
	Record<GuideTopic, ReadonlyArray<GuideBlock>>
> = {
	start: [
		{ kind: "text", key: "intro" },
		{ kind: "text", key: "preview" },
		{
			kind: "list",
			heading: "check.heading",
			items: ["check.overview", "check.connection", "check.busy", "check.mock"],
		},
	],
	keys: [
		{ kind: "text", key: "intro" },
		{
			kind: "list",
			heading: "edit.heading",
			items: ["edit.choose", "edit.select", "edit.save"],
		},
		{
			kind: "list",
			heading: "manage.heading",
			items: ["manage.lists", "manage.default", "manage.linked"],
		},
		{ kind: "note", key: "permissions", tone: "info" },
	],
	knob: [
		{ kind: "text", key: "intro" },
		{
			kind: "terms",
			items: [term("turn"), term("press"), term("double"), term("hold")],
		},
		{ kind: "text", key: "focus" },
		{ kind: "text", key: "controls" },
		{ kind: "note", key: "unverified", tone: "warning" },
	],
	voice: [
		{ kind: "text", key: "intro" },
		{
			kind: "list",
			heading: "setup.heading",
			items: ["setup.agent", "setup.recognition", "setup.answers"],
		},
		{
			kind: "list",
			heading: "privacy.heading",
			items: ["privacy.microphone", "privacy.audio", "privacy.keys"],
		},
		{
			kind: "list",
			heading: "limits.heading",
			items: ["limits.online", "limits.unverified"],
		},
	],
	places: [{ kind: "text", key: "intro" }, { kind: "places" }],
	limits: [
		{
			kind: "list",
			heading: "list.heading",
			items: [
				"list.firmware",
				"list.calibration",
				"list.lighting",
				"list.hostKeyboard",
				"list.appUpdates",
				"list.cloud",
			],
		},
		{ kind: "note", key: "simulated", tone: "warning" },
	],
};

/** Sidebar pages in sidebar order; labels come from navigation, not copy. */
export const GUIDE_PLACES: ReadonlyArray<ManagementPage> = [
	"overview",
	"keys",
	"profiles",
	"screen",
	"controls",
	"connection",
	"agents",
	"shortcuts",
	"emoji",
	"meetings",
	"home-assistant",
	"appearance",
	"settings",
];

/** Every dictionary key the guide reads, for completeness checks. */
export function guideKeys(): ReadonlyArray<string> {
	const keys = [
		"guide.rowLabel",
		"guide.rowHint",
		"guide.open",
		"guide.title",
		"guide.subtitle",
		"guide.close",
		"guide.topicsLabel",
		"guide.topicOf",
		"guide.previous",
		"guide.next",
		"guide.done",
		"guide.go",
		"guide.openPage",
	];
	for (const topic of GUIDE_TOPICS) {
		const at = (key: string) => `guide.topics.${topic}.${key}`;
		keys.push(at("label"), at("title"));
		for (const block of GUIDE_CONTENT[topic]) {
			if (block.kind === "text" || block.kind === "note")
				keys.push(at(block.key));
			else if (block.kind === "list")
				keys.push(at(block.heading), ...block.items.map(at));
			else if (block.kind === "terms")
				for (const item of block.items)
					keys.push(at(item.term), at(item.detail));
			else keys.push(...GUIDE_PLACES.map((page) => `guide.places.${page}`));
		}
	}
	return keys;
}

/** Clamped topic movement; the guide never wraps from the last to the first. */
export function stepTopic(current: GuideTopic, delta: -1 | 1): GuideTopic {
	const index = GUIDE_TOPICS.indexOf(current) + delta;
	return GUIDE_TOPICS[index] ?? current;
}

type Focusable = {
	readonly isConnected: boolean;
	readonly focus: (options?: FocusOptions) => void;
};

/**
 * Focus restoration for closing the guide. Dismissal returns focus to the
 * control that opened it while that control is still in the document;
 * navigating elsewhere leaves focus to the page that replaces it.
 */
export function restoreFocus(
	opener: Focusable | null,
	reason: "dismiss" | "navigate",
): boolean {
	if (reason !== "dismiss" || !opener?.isConnected) return false;
	opener.focus({ preventScroll: true });
	return true;
}
