import { RuntimeLimitExceeded } from "./runtime-errors.js";
export interface SseEvent {
	readonly event: string;
	readonly data: string;
	readonly id?: string;
}
export function makeSseParser(maxEventBytes: number) {
	const decoder = new TextDecoder("utf-8", { fatal: true });
	const encoder = new TextEncoder();
	let line = "";
	let data: string[] = [];
	let event = "";
	let id: string | undefined;
	let eventBytes = 0;
	let swallowLF = false;
	const recordLine = (output: SseEvent[]) => {
		if (line === "") {
			if (data.length > 0)
				output.push({
					event: event || "message",
					data: data.join("\n"),
					...(id === undefined ? {} : { id }),
				});
			data = [];
			event = "";
			eventBytes = 0;
			return;
		}
		eventBytes += encoder.encode(line).byteLength + 1;
		if (eventBytes > maxEventBytes) throw new RuntimeLimitExceeded();
		if (line.startsWith(":")) return;
		const colon = line.indexOf(":");
		const field = colon < 0 ? line : line.slice(0, colon);
		let value = colon < 0 ? "" : line.slice(colon + 1);
		if (value.startsWith(" ")) value = value.slice(1);
		if (field === "data") data.push(value);
		if (field === "event") event = value;
		if (field === "id" && !value.includes("\0")) id = value;
	};
	const consume = (text: string): readonly SseEvent[] => {
		const output: SseEvent[] = [];
		let start = 0;
		if (swallowLF && text.length > 0) {
			if (text[0] === "\n") start = 1;
			swallowLF = false;
		}
		for (let index = start; index < text.length; index++) {
			const char = text[index];
			if (char !== "\n" && char !== "\r") continue;
			line += text.slice(start, index);
			recordLine(output);
			line = "";
			if (char === "\r") {
				if (text[index + 1] === "\n") index++;
				else if (index === text.length - 1) swallowLF = true;
			}
			start = index + 1;
		}
		line += text.slice(start);
		if (
			line.length > maxEventBytes ||
			eventBytes + encoder.encode(line).byteLength > maxEventBytes
		)
			throw new RuntimeLimitExceeded();
		return output;
	};
	return {
		feed: (bytes: Uint8Array): readonly SseEvent[] =>
			consume(decoder.decode(bytes, { stream: true })),
		// SSE dispatch requires a blank line. An incomplete event at EOF is discarded.
		finish: (): readonly SseEvent[] => consume(decoder.decode()),
	};
}
