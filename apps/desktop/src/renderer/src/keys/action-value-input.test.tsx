// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import type { ProfileJson } from "../../../../../../packages/device/src/profiles/profile-contracts";
import { click, input, mount, query } from "../../test/dom";
import { ActionValueInput } from "./ActionValueInput";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const close of cleanup.splice(0)) await close();
});

it("keeps boolean action values as booleans", async () => {
	let value: ProfileJson = true;
	const f = await mount(
		<ActionValueInput
			id="value"
			action={{ type: "force", value }}
			onChange={(next) => {
				value = next;
			}}
		/>,
	);
	cleanup.push(f.close);
	await click(query(f.host, "#value", HTMLInputElement));
	expect(value).toBe(false);
});

it("keeps structured action values as JSON and explains malformed input without publishing it", async () => {
	let value: ProfileJson = { enabled: true, steps: [1, 2] };
	const f = await mount(
		<ActionValueInput
			id="value"
			action={{ type: "settings", value }}
			onChange={(next) => {
				value = next;
			}}
		/>,
	);
	cleanup.push(f.close);
	const field = query(f.host, "#value", HTMLTextAreaElement);
	await input(field, '{"enabled":false,"steps":[3]}');
	expect(value).toEqual({ enabled: false, steps: [3] });
	await input(field, "{");
	expect(field.getAttribute("aria-invalid")).toBe("true");
	expect(f.host.textContent).toContain("Enter a valid JSON value.");
	expect(value).toEqual({ enabled: false, steps: [3] });
});

it("reports malformed JSON so the editor can refuse to save the stale value", async () => {
	const validity: boolean[] = [];
	const f = await mount(
		<ActionValueInput
			id="value"
			action={{ type: "settings", value: { enabled: true } }}
			onChange={() => {}}
			onValidityChange={(valid) => validity.push(valid)}
		/>,
	);
	cleanup.push(f.close);
	const field = query(f.host, "#value", HTMLTextAreaElement);
	await input(field, '{"enabled":');
	expect(validity.at(-1)).toBe(false);
	await input(field, '{"enabled":false}');
	expect(validity.at(-1)).toBe(true);
});

it("keeps a cleared numeric draft without publishing it and restores validity with a replacement", async () => {
	const values: ProfileJson[] = [];
	const valid: boolean[] = [];
	const f = await mount(
		<ActionValueInput
			id="number"
			action={{ type: "time", value: 12 }}
			onChange={(value) => {
				values.push(value);
			}}
			onValidityChange={(value) => {
				valid.push(value);
			}}
		/>,
	);
	cleanup.push(f.close);
	const field = query(f.host, "#number", HTMLInputElement);
	await input(field, "");
	expect(field.value).toBe("");
	expect(values).toEqual([]);
	expect(valid.at(-1)).toBe(false);
	await input(field, "24");
	expect(values).toEqual([24]);
	expect(valid.at(-1)).toBe(true);
});

it("preserves the legacy blank force value as valid", async () => {
	let value: ProfileJson = 1;
	let valid = false;
	const f = await mount(
		<ActionValueInput
			id="force"
			action={{ type: "force", value }}
			onChange={(next) => {
				value = next;
			}}
			onValidityChange={(next) => {
				valid = next;
			}}
		/>,
	);
	cleanup.push(f.close);
	await input(query(f.host, "#force", HTMLInputElement), "");
	expect(value).toBe("");
	expect(valid).toBe(true);
});

it("releases an invalid field's Save blocker when it is removed", async () => {
	let valid = true;
	const f = await mount(
		<ActionValueInput
			id="json"
			action={{ type: "settings", value: { enabled: true } }}
			onChange={() => {}}
			onValidityChange={(next) => {
				valid = next;
			}}
		/>,
	);
	cleanup.push(f.close);
	await input(query(f.host, "#json", HTMLTextAreaElement), "{");
	expect(valid).toBe(false);
	await f.render(<div />);
	expect(valid).toBe(true);
});
