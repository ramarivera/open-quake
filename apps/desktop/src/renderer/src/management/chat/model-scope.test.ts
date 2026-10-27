import { describe, expect, it } from "vitest";
import { defaultAssistantSettings } from "../../../../../../../packages/device/src/profiles/assistant-contracts";
import type { PublicModelRow } from "../../../../shared/agents";
import { directChatModel } from "./model-scope";

const row = (patch: Partial<PublicModelRow>): PublicModelRow => ({
	id: "row",
	role: "default",
	provider: "generic",
	model: "model",
	baseUrl: "http://127.0.0.1:1/v1",
	maxTokens: 512,
	credentialAvailable: true,
	...patch,
});

describe("direct chat effective model scope", () => {
	it("is ready from a custom main-agent model when the global default is empty", () => {
		const result = directChatModel({
			default: [row({ id: "d", model: "", credentialAvailable: false })],
			main: [row({ id: "m", model: "main-model" })],
		});
		expect(result).toMatchObject({ ready: true, row: { id: "m" } });
	});
	it("follows a main-agent override even when the global default is ready", () => {
		const result = directChatModel({
			default: [row({ id: "d" })],
			main: [row({ id: "m", credentialAvailable: false })],
		});
		expect(result).toMatchObject({ ready: false, row: { id: "m" } });
	});
	it("falls back to the global default without a main-agent scope", () => {
		expect(directChatModel({ default: [row({ id: "d" })] })).toMatchObject({
			ready: true,
			row: { id: "d" },
		});
		expect(directChatModel(undefined)).toEqual({
			ready: false,
			row: undefined,
		});
	});
	it("ignores fallback-only rows, which the host doesn't submit with", () => {
		expect(
			directChatModel({ default: [row({ role: "fallback" })] }).ready,
		).toBe(false);
	});
});

it.each(["default", "fallback"] as const)(
	"uses an explicit persona %s catalog row over the keyless main default",
	(role) => {
		const models = {
			main: [row({ credentialAvailable: false })],
			default: [row({ id: "selected", role })],
		};
		expect(
			directChatModel(models, {
				...defaultAssistantSettings(),
				modelRowId: "selected",
				modelId: "custom-model",
			}),
		).toMatchObject({
			ready: true,
			row: { id: "selected", model: "custom-model" },
		});
		expect(models.main[0]?.credentialAvailable).toBe(false);
	},
);
it("uses the default catalog for a session persona that follows General settings", () => {
	const models = {
		main: [row({ credentialAvailable: false })],
		default: [row({ id: "general" })],
	};
	expect(
		directChatModel(models, defaultAssistantSettings(), true),
	).toMatchObject({ ready: true, row: { id: "general" } });
	expect(directChatModel(models, defaultAssistantSettings()).ready).toBe(false);
	expect(
		directChatModel(models, {
			...defaultAssistantSettings(),
			modelRowId: "missing",
		}).ready,
	).toBe(false);
	expect(
		directChatModel(
			{ default: [row({ role: "none" })] },
			{ ...defaultAssistantSettings(), modelRowId: "row" },
		).ready,
	).toBe(false);
});
