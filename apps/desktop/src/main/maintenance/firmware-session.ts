import { randomUUID } from "node:crypto";
import { readFile, rename } from "node:fs/promises";
import { Effect, Schema } from "effect";
import { FirmwareSnapshot } from "../../../../../packages/edge/src/maintenance/contracts.js";
import { FirmwarePersistenceFailed } from "../../../../../packages/edge/src/maintenance/maintenance-errors.js";
import { atomicJson } from "./firmware-files";

/** Preserve unreadable records before allowing an explicit session save to replace them. */
export function firmwareSessionStore(path: string) {
	let preserveBeforeSave = false;
	const preserve = async () => {
		await rename(path, `${path}.recovery-${randomUUID()}`);
		preserveBeforeSave = false;
	};
	const report = (cause: unknown) => {
		const error = new FirmwarePersistenceFailed(cause);
		Effect.runSync(
			Effect.logWarning("Firmware session requires recovery", {
				code: error.code,
				diagnosticCause: error.diagnosticCause,
			}),
		);
	};
	return {
		load: async (): Promise<unknown> => {
			try {
				return Schema.decodeUnknownSync(FirmwareSnapshot)(
					JSON.parse(await readFile(path, "utf8")),
				);
			} catch (cause) {
				if (
					typeof cause === "object" &&
					cause !== null &&
					"code" in cause &&
					cause.code === "ENOENT"
				)
					return undefined;
				preserveBeforeSave = true;
				report(cause);
				try {
					await preserve();
				} catch (preservationFailure) {
					report(preservationFailure);
				}
				// Empty state permits settings/export/reset. No DFU or copy is resumed.
				return undefined;
			}
		},
		save: async (snapshot: FirmwareSnapshot): Promise<void> => {
			if (preserveBeforeSave) await preserve();
			await atomicJson(path, snapshot);
		},
	};
}
