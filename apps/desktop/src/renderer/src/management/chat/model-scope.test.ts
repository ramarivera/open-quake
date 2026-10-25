import { describe, expect, it } from "vitest";
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
