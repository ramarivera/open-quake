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
	const processes = output.split("\n").flatMap((line) => {
		const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
		return match
			? [
					{
						pid: Number(match[1]),
						parent: Number(match[2]),
						command: match[3] ?? "",
					},
				]
			: [];
	});
	const ancestors = new Set<number>();
	let parent = processes.find((entry) => entry.pid === ownPid)?.parent;
	while (parent && !ancestors.has(parent)) {
		ancestors.add(parent);
		parent = processes.find((entry) => entry.pid === parent)?.parent;
	}
	const parents = new Map(processes.map(({ pid, parent }) => [pid, parent]));
	const isDescendant = (pid: number): boolean => {
		const seen = new Set<number>();
		let parent = parents.get(pid);
		while (parent && !seen.has(parent)) {
			if (parent === ownPid) return true;
			seen.add(parent);
			parent = parents.get(parent);
		}
		return false;
	};
	return processes.flatMap(({ pid, command }) => {
		if (pid === ownPid) return [];
		// Electron creates these helpers before app readiness; they aren't HID owners.
		if (
			isDescendant(pid) &&
			/--type=(?:gpu-process|utility|renderer|zygote)(?:\s|$)/.test(command)
		)
			return [];
		// pnpm and Electron's JS launcher do not own HID. Exclude only our ancestors.
		if (
			ancestors.has(pid) &&
			/(?:^|[\s/])(?:pnpm(?:\.c?js)?|electron\/cli\.js)(?:\s|$)/i.test(command)
		)
			return [];
		return /DK[- ]?Suite(?:\.app|\b)/i.test(command) ||
			// Only the product executable or bundle, not tools given the repo path.
			/^(?:\S*\/)?open-quake(?:\s|$)/i.test(command) ||
			/open-quake\.app\//i.test(command) ||
			(/electron(?:-vite)?/i.test(command) &&
				/(?:open-quake|\boq-[\w-]+)/i.test(command))
			? [pid]
			: [];
	});
}

/** Extended lighting accepts only the three source-qualified volatile legacy fields. */
export function allowedExtendedWrite(
	report: Uint8Array,
	mutations: boolean,
): boolean {
	if (allowedAcceptanceWrite(report, mutations)) return true;
	if (report.length !== 33 || report[0] !== 0) return false;
	const command = report[1],
		field = report[2];
	if (
		field === 3 &&
		report[3] !== undefined &&
		[1, 2, 3, 4].includes(report[3])
	) {
		const size = report[3] === 4 ? 2 : 1;
		if (command === 8) return report.slice(4).every((byte) => byte === 0);
		// Only speed has a verified byte-for-byte native round trip on this V3 firmware.
		return (
			mutations &&
			command === 7 &&
			report[3] === 3 &&
			report.slice(4 + size).every((byte) => byte === 0)
		);
	}
	const length = field === 12 ? 2 : field === 9 || field === 11 ? 1 : 0;
	if (!length) return false;
	if (command === 8) return report.slice(3).every((byte) => byte === 0);
	return (
		mutations &&
		command === 7 &&
		report.slice(3 + length).every((byte) => byte === 0)
	);
}
