import { expect, it } from "vitest";
import { surfaceQuery } from "./surface-query";

it("adds raw input diagnostics only to an explicitly opted-in development panel", () => {
	for (const development of [false, true])
		for (const surface of ["management", "panel"] as const)
			for (const flag of [undefined, "0", "1", "true"]) {
				const query = surfaceQuery(surface, 90, "fixture", development, flag);
				expect(query).toMatchObject({
					surface,
					rotation: "90",
					serial: "fixture",
				});
				expect(query.inputDiagnostics).toBe(
					development && surface === "panel" && flag === "1" ? "1" : undefined,
				);
			}
});
