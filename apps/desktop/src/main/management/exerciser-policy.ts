import type { Control } from "./exerciser-dom";

/** Reviewed exclusions. Match action labels, not whole pages or device identities. */
export const skipRules = [
	{
		pattern:
			/delete|remove|reset|factory|firmware|\bdfu\b|quit|exit|sign.?out|restart|relaunch/i,
		reason: "Destructive or process-ending action",
	},
	{
		pattern:
			/buzzer|lock screen|screenshot|force quit|volume|\bmute\b|launchpad|mission control|expos[ée]/i,
		reason: "Native Mac action or audible output",
	},
	{
		pattern:
			/login|log in|start.*system|launch.*start|start.*login|permission|allow access|input monitoring|accessibility|microphone|screen recording|open.*settings|system settings|show.*finder|reveal.*finder/i,
		reason: "Changes OS state or opens native settings",
	},
	{
		pattern:
			/install|download|update now|connect|pair|discover|start runtime|start local|run command|test command|execute|record|\bplay\b|send|generate|capture|import|export|choose.*file|browse|upload|color/i,
		reason: "External IO, native picker, execution or paid generation",
	},
];

export const allowedKinds = [
	"button",
	"a",
	"select",
	"input",
	"textarea",
	"summary",
];
export const expectedInert = [
	{
		id: "selected",
		reason:
			"Already selected tab, radio or emoji package; activating it preserves the selected state",
	},
	{ id: "single-option", reason: "Selector has no alternative enabled option" },
];

export function skipReason(control: Control): string | undefined {
	if (/-login$/.test(control.identity))
		return "OS login preference; never mutate the real Mac";
	if (control.generated)
		return "Record created by the exerciser; do not recursively duplicate or edit generated records";
	const rule = skipRules.find(({ pattern }) =>
		pattern.test(`${control.label} ${control.context}`),
	);
	if (rule) return rule.reason;
	if (control.disabled)
		return "Disabled by the rendered application; targeted scenarios separately fail required disabled controls";
	if (["file", "color", "password"].includes(control.type))
		return "Native picker or credential field";
	if (!allowedKinds.includes(control.tag)) return undefined;
	return undefined;
}
