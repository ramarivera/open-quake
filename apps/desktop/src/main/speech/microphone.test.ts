import { describe, expect, it } from "vitest";
import { normalizeMicrophone, recoverMicrophone } from "../../shared/speech";

const mic = (deviceId: string, groupId = "", label = "") => ({
	deviceId,
	groupId,
	label,
});
describe("shared microphone identity", () => {
	it("normalizes legacy strings, partial objects and defaults without inventing an input", () => {
		for (const value of [undefined, null, "  ", false, {}, { deviceId: "" }])
			expect(normalizeMicrophone(value)).toBeUndefined();
		expect(normalizeMicrophone(" chosen ")).toEqual(mic("chosen"));
		expect(
			normalizeMicrophone({
				deviceId: " id ",
				label: " Desk ",
				groupId: " group ",
			}),
		).toEqual(mic("id", "group", "Desk"));
		expect(normalizeMicrophone({ deviceId: "id" })).toEqual(mic("id"));
	});
	it("recovers only the ordered unique exact/group/group+label/no-group label matches", () => {
		const saved = mic("old", "g", "Desk");
		expect(
			recoverMicrophone(saved, [mic("old", "other"), mic("new", "g")])
				?.deviceId,
		).toBe("old");
		expect(
			recoverMicrophone(saved, [mic("new", "g", "Renamed")])?.deviceId,
		).toBe("new");
		expect(
			recoverMicrophone(saved, [
				mic("new", "g", "Desk"),
				mic("other", "g", "Other"),
			])?.deviceId,
		).toBe("new");
		expect(
			recoverMicrophone(saved, [mic("a", "g", "Desk"), mic("b", "g", "Desk")]),
		).toBeUndefined();
		expect(
			recoverMicrophone(saved, [mic("new", "wrong", "Desk")]),
		).toBeUndefined();
		expect(
			recoverMicrophone(mic("old", "", "Desk"), [mic("new", "wrong", "Desk")])
				?.deviceId,
		).toBe("new");
		expect(
			recoverMicrophone(mic("old", "", "Desk"), [
				mic("a", "", "Desk"),
				mic("b", "", "Desk"),
			]),
		).toBeUndefined();
		expect(recoverMicrophone(saved, [])).toBeUndefined();
	});
	it("prefers default or first only when no physical input is saved", () => {
		const inputs = [mic("first"), mic("default")];
		expect(recoverMicrophone(undefined, inputs)?.deviceId).toBe("default");
		expect(recoverMicrophone(undefined, inputs.slice(0, 1))?.deviceId).toBe(
			"first",
		);
		expect(recoverMicrophone(mic("missing"), inputs)).toBeUndefined();
	});
});
