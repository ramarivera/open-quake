import assert from "node:assert/strict";
import { decodeHidReport, unwrapShortCommand } from "@open-quake/protocol";
import { Either } from "effect";

export function acceptanceOptions(env: NodeJS.ProcessEnv) {
	assert.equal(
		env.OPEN_QUAKE_HW_E2E,
		"1",
		"Native hardware E2E requires explicit opt-in",
	);
	const serial = env.OPEN_QUAKE_HW_E2E_SERIAL;
	assert(
		serial?.trim() && serial === serial.trim() && !serial.includes(":"),
		"Supply the exact canonical device serial",
	);
	const directory = env.OPEN_QUAKE_HW_E2E_ARTIFACTS;
	assert(
		typeof directory === "string" && directory.startsWith("/"),
		"Supply an absolute scratch artifact directory",
	);
	return {
		serial,
		mutations: env.OPEN_QUAKE_HW_E2E_MUTATIONS === "1",
		directory,
	};
}

/** Only the selected read commands or separately enabled reversible settings. */
export function allowedAcceptanceWrite(
	report: Uint8Array,
	mutations: boolean,
): boolean {
	if (report.length !== 33 || report[0] !== 0) return false;
	if (report[1] === 1 && report.slice(2).every((byte) => byte === 0))
		return true;
	const decoded = decodeHidReport(report).pipe(
		Either.flatMap(unwrapShortCommand),
	);
	if (Either.isLeft(decoded)) return false;
	const { opCode, cmdId, subData } = decoded.right;
	if (opCode === 2)
		return [3, 5, 6, 0x2e, 0xef].includes(cmdId) && subData.length === 0;
	if (!mutations || opCode !== 1 || subData.length !== 1) return false;
	const value = subData[0];
	return cmdId === 5
		? value !== undefined && value >= 25
		: [3, 6].includes(cmdId) && (value === 0 || value === 1);
}

export function competingOwners(output: string, ownPid: number): number[] {
	return output.split("\n").flatMap((line) => {
		const match = line.trim().match(/^(\d+)\s+(.+)$/);
		if (!match || Number(match[1]) === ownPid) return [];
		const command = match[2] ?? "";
		return /DK[- ]?Suite(?:\.app|\b)/i.test(command) ||
			/(?:^|[\s/])open-quake(?:\.app|\s|$)/i.test(command) ||
			(/electron(?:-vite)?/i.test(command) &&
				/(?:open-quake|\boq-[\w-]+)/i.test(command))
			? [Number(match[1])]
			: [];
	});
}
