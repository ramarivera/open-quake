import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

/** A fresh interactive challenge cannot be replayed through inherited environment. */
export async function confirmKeyboardReadiness(
	readLine: (prompt: string) => Promise<string>,
) {
	const confirmation = `QUAKE ${randomUUID()}`;
	const answer = await readLine(
		`This run will focus the QUAKE keyboard acceptance window and type one letter. Leave the keyboard and mouse untouched until TEST FINISHED. Type "${confirmation}" to authorize this run: `,
	);
	assert.equal(
		answer.trim() === confirmation,
		true,
		"Requires a new supervised acknowledgement for this keyboard run",
	);
}
