// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import type { Entity } from "../../../../../../../packages/edge/src/home-assistant/ha-contracts";
import {
	defaultAllowlist,
	groupEntities,
} from "../../../../../../../packages/edge/src/home-assistant/ha-invariants";
import { integrationFixture } from "../../../../main/integrations/test-fixtures";
import type {
	IntegrationRequest,
	IntegrationsBridge,
} from "../../../../shared/integrations";
import { button, click, mount, settle } from "../../../test/dom";
import { HomeAssistantPage } from "./HomeAssistantPage";

const domains = [
	"climate",
	"light",
	"media_player",
	"person",
	"sensor",
	"switch",
	"weather",
];
const entities: readonly Entity[] = [
	...domains.map((domain, i) => ({
		entity_id: `${domain}.fixture`,
		state: "on",
		attributes: { friendly_name: `Friendly ${domain}` },
		area: i % 2 ? "Study" : "Other",
	})),
	{
		entity_id: "button.reset",
		state: "off",
		attributes: { friendly_name: "Excluded reset" },
		area: "Kitchen",
	},
];
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const close of cleanups.splice(0).reverse()) await close();
	vi.unstubAllGlobals();
});
it("CENTER-100 groups all seven AI domains with friendly labels and Other last", () => {
	expect(defaultAllowlist(entities)).toEqual(
		domains.map((d) => `${d}.fixture`),
	);
	expect(groupEntities(entities, "room").map((g) => g.name)).toEqual([
		"Kitchen",
		"Study",
		"Other",
	]);
	expect(groupEntities(entities, "entity").map((g) => g.name)).toEqual([
		"button",
		"climate",
		"light",
		"media_player",
		"person",
		"sensor",
		"switch",
		"weather",
	]);
});
it("CENTER-100 saves and reloads only checked leaves after switching room and domain grouping", async () => {
	const f = integrationFixture();
	cleanups.push(f.dispose);
	f.entities(entities);
	expect(
		(
			await f.request({
				type: "ha.connect",
				origin: "https://ha.example",
				token: "synthetic-ha-credential",
			})
		).type,
	).toBe("ha");
	const calls: IntegrationRequest[] = [];
	const bridge: IntegrationsBridge = {
		request: async (command) => {
			calls.push(command);
			return f.request(command);
		},
		onHaLive: () => () => {},
	};
	vi.stubGlobal("quakeIntegrations", bridge);
	let mounted = await mount(<HomeAssistantPage />);
	cleanups.push(() => mounted.close());
	await settle(() =>
		expect(mounted.host.querySelectorAll("aside fieldset")).toHaveLength(3),
	);
	const leaf = (name: string) => {
		const label = Array.from(
			mounted.host.querySelectorAll("aside fieldset > label"),
		).find((e) => e.textContent === name);
		const input = label?.querySelector("input");
		if (!(input instanceof HTMLInputElement))
			throw new Error(`Missing leaf ${name}`);
		return input;
	};
	expect(
		Array.from(mounted.host.querySelectorAll("aside legend")).map(
			(e) => e.textContent,
		),
	).toEqual(["Kitchen", "Study", "Other"]);
	for (const d of domains) expect(leaf(`Friendly ${d}`).checked).toBe(true);
	expect(leaf("Excluded reset").checked).toBe(false);
	await click(button(mounted.host, "By entity"));
	expect(mounted.host.querySelectorAll("aside fieldset")).toHaveLength(8);
	await click(leaf("Friendly light"));
	await click(leaf("Excluded reset"));
	await click(
		button(mounted.host.querySelector("aside") ?? mounted.host, "Save"),
	);
	const expected = [
		...domains.filter((d) => d !== "light").map((d) => `${d}.fixture`),
		"button.reset",
	];
	expect(calls.filter((c) => c.type === "ha.allowlist")).toEqual([
		{ type: "ha.allowlist", ids: expected },
	]);
	expect(f.ha.read()).toMatchObject({ allowlist: expected });
	await mounted.close();
	mounted = await mount(<HomeAssistantPage />);
	await settle(() =>
		expect(mounted.host.querySelectorAll("aside fieldset")).toHaveLength(3),
	);
	expect(leaf("Friendly light").checked).toBe(false);
	expect(leaf("Excluded reset").checked).toBe(true);
});
