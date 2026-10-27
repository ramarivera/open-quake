import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Leave the initial incomplete result intact if reading or validation fails. */
export async function finalizeNativeResult(
	directory: string,
	serial: string,
	report: {
		readonly diagnostics: {
			readonly storageFailures: number;
			readonly dropped: number;
		};
	},
) {
	const diagnostics = join(directory, "diagnostics");
	const text = (
		await Promise.all(
			(
				await readdir(diagnostics)
			)
				.filter((name) => name.endsWith(".ndjson"))
				.map((name) => readFile(join(diagnostics, name), "utf8")),
		)
	).join("\n");
	assert(
		!text.includes(serial),
		"Raw device serial must not enter diagnostics",
	);
	assert(
		!text.includes('"span_name":"redacted.span"'),
		"Acceptance spans must be reviewed names",
	);
	assert.equal(report.diagnostics.storageFailures, 0);
	assert.equal(report.diagnostics.dropped, 0);
	const temporary = join(directory, `.result-${randomUUID()}.json`);
	try {
		await writeFile(temporary, JSON.stringify(report, null, 2), {
			flag: "wx",
			mode: 0o600,
		});
		// Rename replaces a result symlink itself, never follows its target.
		await rename(temporary, join(directory, "result.json"));
	} finally {
		await rm(temporary, { force: true });
	}
}
