import { Schema } from "effect";
import { KnobRequest } from "../../shared/knob-contracts";

export function canRequestKnob(
	caller: string,
	renderer: string,
	input: unknown,
	isPanel: boolean,
): boolean {
	if (!Schema.is(KnobRequest)(input)) return false;
	try {
		const url = new URL(caller);
		const expected = new URL(renderer);
		return (
			url.protocol === expected.protocol &&
			url.host === expected.host &&
			url.pathname === expected.pathname &&
			(input._tag === "Read" || isPanel)
		);
	} catch {
		return false;
	}
}
