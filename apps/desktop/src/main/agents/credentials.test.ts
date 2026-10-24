import { Effect, Layer, ManagedRuntime, Option, Redacted } from "effect";
import { describe, expect, it } from "vitest";
import { CredentialVault, MacOsKeychain } from "../credentials/keychain";
import { agentCredentialsFromVault } from "./credentials";

describe("agent write-only credential binding", () => {
	it("stores only through the existing vault, exposes availability and handles revoked credentials", async () => {
		const native = new Map<string, Redacted.Redacted<string>>();
		const runtime = ManagedRuntime.make(
			CredentialVault.Default.pipe(
				Layer.provide(
					Layer.succeed(MacOsKeychain, {
						write: async (_namespace, account, secret) => {
							native.set(account, secret);
						},
						read: async (_namespace, account) =>
							Option.fromNullable(native.get(account)),
						remove: async (_namespace, account) => {
							native.delete(account);
						},
					}),
				),
			),
		);
		try {
			const vault = await runtime.runPromise(CredentialVault);
			const binding = agentCredentialsFromVault(vault);
			const ref = await runtime.runPromise(
				binding.store(Redacted.make("private-agent-key")),
			);
			expect(await runtime.runPromise(binding.available(ref))).toBe(true);
			expect(Redacted.value(native.get(ref) ?? Redacted.make(""))).toBe(
				"private-agent-key",
			);
			await runtime.runPromise(binding.remove(ref));
			expect(await runtime.runPromise(binding.available(ref))).toBe(false);
			expect(native.size).toBe(0);
		} finally {
			await runtime.dispose();
		}
	});
	it("preserves secure-store failure identity and private causes without returning secret text", async () => {
		const cause = new Error("apiKey=private-agent-key");
		const runtime = ManagedRuntime.make(
			CredentialVault.Default.pipe(
				Layer.provide(
					Layer.succeed(MacOsKeychain, {
						write: async () => {
							throw cause;
						},
						read: async () => Option.none(),
						remove: async () => {},
					}),
				),
			),
		);
		try {
			const vault = await runtime.runPromise(CredentialVault);
			const result = await runtime.runPromise(
				agentCredentialsFromVault(vault)
					.store(Redacted.make("private-agent-key"))
					.pipe(Effect.either),
			);
			expect(result._tag).toBe("Left");
			if (result._tag === "Left") {
				expect(result.left.code).toBe("AGENT.CREDENTIAL.UNAVAILABLE");
				expect(result.left.originalCause).toMatchObject({
					_tag: "AiCredentialStoreFailed",
					originalCause: cause,
				});
				expect(JSON.stringify(result.left)).not.toContain("private-agent-key");
			}
		} finally {
			await runtime.dispose();
		}
	});
});
