import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { registerAgentHttp } from "./index";

vi.mock("electron", () => ({
	app: {},
	ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
	safeStorage: { isEncryptionAvailable: () => false },
}));
afterEach(() => vi.unstubAllGlobals());

it("recognizes saved HTTP configuration before connectivity and after restart without calling the server", async () => {
	const root = await mkdtemp(join(tmpdir(), "oq-runtime-configured-"));
	const fetch = vi.fn(() => {
		throw new Error("Setup must not probe a runtime");
	});
	vi.stubGlobal("fetch", fetch);
	const options = {
		root,
		management: () => undefined,
		renderer: "file:///app/index.html",
		invalidated: async () => {},
		publish: async () => {},
	};
	let runtime = await registerAgentHttp(options);
	try {
		expect(await runtime.configured()).toBe(false);
		await runtime.dispose();
		await writeFile(
			join(root, "connections-v1.json"),
			JSON.stringify({
				version: 1,
				revision: 1,
				cleanupRefs: [],
				connections: [
					{
						id: randomUUID(),
						name: "Offline Hermes",
						kind: "hermes",
						baseURL: "http://127.0.0.1:1",
					},
				],
			}),
		);
		runtime = await registerAgentHttp(options);
		expect(await runtime.configured()).toBe(true);
		expect(runtime.backend.initial.status).toBe("error");
		expect(fetch).not.toHaveBeenCalled();
	} finally {
		await runtime.dispose();
		await rm(root, { recursive: true, force: true });
	}
});
