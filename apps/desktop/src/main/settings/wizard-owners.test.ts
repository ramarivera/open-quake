import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createInitialProfileEnvelope } from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { installProfileCatalog } from "../../../../../packages/device/src/profiles/profile-manager-invariants.js";
import { createWizardOwners } from "./wizard-owners";

describe("wizard canonical owner probes", () => {
	it("rechecks identity and current profile presence instead of trusting saved progress", async () => {
		let deviceId: string | undefined = "a";
		let profiles = createInitialProfileEnvelope();
		const owners = createWizardOwners({
			deviceId: async () => deviceId,
			profiles: async () => profiles,
			runtimeSupported: () => true,
			runtimeConfigured: async () => false,
		});
		expect(
			await Effect.runPromise(
				owners.displayAvailable({ _tag: "quake", deviceId: "a" }),
			),
		).toBe(true);
		deviceId = "b";
		expect(
			await Effect.runPromise(
				owners.displayAvailable({ _tag: "quake", deviceId: "a" }),
			),
		).toBe(false);
		expect(
			await Effect.runPromise(owners.usableProfiles(["local-profile"])),
		).toBe(true);
		profiles = {
			...profiles,
			profiles: [{ ...profiles.profiles[0], id: "replacement" }],
		};
		expect(
			await Effect.runPromise(owners.usableProfiles(["local-profile"])),
		).toBe(false);
		deviceId = undefined;
		expect(
			await Effect.runPromise(
				owners.displayAvailable({ _tag: "desktop-preview" }),
			),
		).toBe(true);
		expect(await Effect.runPromise(owners.runtimeSupported)).toBe(true);
		expect(await Effect.runPromise(owners.runtimeConfigured)).toBe(false);
		expect(await Effect.runPromise(owners.regionSuggestions("DE"))).toEqual({
			provider: "OpenAI",
			speech: "OpenAI",
		});
	});
	it("rejects hidden installed profiles using the manager's selection rules", async () => {
		const envelope = installProfileCatalog(
			createInitialProfileEnvelope(),
			"darwin",
		);
		const owners = createWizardOwners({
			deviceId: () => undefined,
			profiles: async () => envelope,
			runtimeSupported: () => true,
			runtimeConfigured: async () => true,
		});
		expect(envelope.profiles.some((profile) => profile.id === "1-0")).toBe(
			true,
		);
		expect(await Effect.runPromise(owners.usableProfiles(["1-0"]))).toBe(false);
		expect(
			await Effect.runPromise(owners.usableProfiles(["local-profile"])),
		).toBe(true);
	});
	it("preserves owner read failures privately with a catalog identity", async () => {
		const cause = new Error("private owner path");
		const owners = createWizardOwners({
			deviceId: () => undefined,
			profiles: async () => {
				throw cause;
			},
			runtimeSupported: () => false,
			runtimeConfigured: async () => false,
		});
		const result = await Effect.runPromise(
			owners.usableProfiles(["local-profile"]).pipe(Effect.either),
		);
		expect(result._tag).toBe("Left");
		if (result._tag === "Left") {
			expect(result.left.code).toBe("QUAKE.WIZARD.INCOMPLETE");
			expect(result.left.originalCause).toBe(cause);
			expect(JSON.stringify(result.left)).not.toContain("private owner path");
		}
	});
});
