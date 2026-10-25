import { describe, expect, it } from "vitest";
import type { RuntimeConnectionView } from "../../../../../../../packages/edge/src/agent-http/runtime-contracts";
import {
	type ConnectionDraft,
	canSaveConnection,
	endpointCredentialRequired,
} from "./connection-draft";

const existing: RuntimeConnectionView = {
	id: "workstation",
	name: "Workstation",
	kind: "openclaw",
	baseURL: "http://workstation.xalda-procyon.ts.net/gateway/",
	credentialAvailable: true,
};
const draft: ConnectionDraft = {
	name: existing.name,
	kind: existing.kind,
	baseURL: existing.baseURL,
	credential: "",
	clearCredential: false,
};

describe("connection form policy", () => {
	it("keeps a saved credential for a name-only edit and canonical equivalent URL", () => {
		expect(
			canSaveConnection(
				{ ...draft, name: "Renamed", baseURL: existing.baseURL.slice(0, -1) },
				existing,
			),
		).toBe(true);
	});

	it.each([
		{ baseURL: "http://another-host:8080/" },
		{ kind: "hermes" as const },
		{ baseURL: "http://workstation.xalda-procyon.ts.net/other/" },
	])(
		"requires an explicit credential decision when endpoint identity changes: %j",
		(change) => {
			const changed = { ...draft, ...change };
			expect(endpointCredentialRequired(changed, existing)).toBe(true);
			expect(canSaveConnection(changed, existing)).toBe(false);
			expect(
				canSaveConnection({ ...changed, credential: "replacement" }, existing),
			).toBe(true);
			expect(
				canSaveConnection({ ...changed, clearCredential: true }, existing),
			).toBe(true);
		},
	);

	it.each([
		"file:///etc/passwd",
		"http://user:private@localhost:8080/",
		"http://localhost:8080/?token=private",
		"http://localhost:8080/#private",
		"http://localhost:8080/api/../admin",
	])("rejects an unsafe address before save: %s", (baseURL) => {
		expect(
			canSaveConnection(
				{ ...draft, baseURL, credential: "replacement" },
				existing,
			),
		).toBe(false);
	});

	it("permits new connections without inventing a credential requirement", () => {
		expect(canSaveConnection(draft, undefined)).toBe(true);
		expect(canSaveConnection({ ...draft, name: "   " }, undefined)).toBe(false);
	});
});
