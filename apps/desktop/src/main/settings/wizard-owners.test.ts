import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createWizardOwners } from "./wizard-owners";

describe("wizard canonical owner probes", () => {
	it("rechecks identity and current profile presence instead of trusting saved progress", async () => {
		let deviceId: string | undefined = "a";
		let profiles = [{ id: "local" }];
		const owners = createWizardOwners({
			deviceId: () => deviceId,
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
		expect(await Effect.runPromise(owners.usableProfiles(["local"]))).toBe(
			true,
		);
		profiles = [];
		expect(await Effect.runPromise(owners.usableProfiles(["local"]))).toBe(
			false,
		);
		deviceId = undefined;
		expect(
			await Effect.runPromise(
				owners.displayAvailable({ _tag: "desktop-preview" }),
			),
		).toBe(true);
		expect(await Effect.runPromise(owners.runtimeSupported)).toBe(true);
		expect(await Effect.runPromise(owners.runtimeConfigured)).toBe(false);
		expect(await Effect.runPromise(owners.regionSuggestions("DE"))).toEqual({});
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
			owners.usableProfiles(["local"]).pipe(Effect.either),
		);
		expect(result._tag).toBe("Left");
		if (result._tag === "Left") {
			expect(result.left.code).toBe("QUAKE.WIZARD.INCOMPLETE");
			expect(result.left.originalCause).toBe(cause);
			expect(JSON.stringify(result.left)).not.toContain("private owner path");
		}
	});
});
