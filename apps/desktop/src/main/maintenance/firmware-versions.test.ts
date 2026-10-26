import { expect, it } from "vitest";
import { firmwareVersions } from "./firmware-versions";

const image = {
	trusted: true,
	fingerprint: "synthetic",
	fileName: "synthetic.uf2",
	bytes: 1024,
	version: "1.0.21",
};
it("retains offline versions, distinguishes all availability reasons and isolates reselection", () => {
	const v = firmwareVersions();
	expect(v.observe("", "", undefined)).toMatchObject({
		currentVersion: "",
		firmwareAvailability: "no_device",
	});
	expect(v.observe("a", "1.0.19", undefined)).toMatchObject({
		firmwareAvailability: "no_bundled_firmware",
	});
	expect(v.observe("a", "1.0.19", image)).toMatchObject({
		currentVersion: "1.0.19",
		firmwareAvailability: "newer_bundled",
	});
	expect(v.observe("", "", image)).toMatchObject({
		serial: "",
		currentVersion: "1.0.19",
		firmwareAvailability: "no_device",
	});
	expect(v.observe("b", "", image)).toMatchObject({
		currentVersion: "",
		firmwareAvailability: "device_version_unknown",
	});
	expect(v.observe("a", "", image)).toMatchObject({
		currentVersion: "1.0.19",
		firmwareAvailability: "newer_bundled",
	});
	v.readback("a", "1.0.21");
	expect(v.observe("a", "1.0.19", image)).toMatchObject({
		currentVersion: "1.0.21",
		firmwareAvailability: "up_to_date",
	});
	expect(v.observe("b", "1.0.20", image)).toMatchObject({
		currentVersion: "1.0.20",
		firmwareAvailability: "newer_bundled",
	});
});

it("lets a newer observed version supersede readback while retaining offline and stale-snapshot protection", () => {
	const v = firmwareVersions();
	v.readback("a", "1.0.19");
	v.observe("", "", image);
	expect(v.observe("a", "1.0.21", image)).toMatchObject({
		currentVersion: "1.0.21",
		firmwareAvailability: "up_to_date",
	});
	expect(v.observe("a", "1.0.19", image).currentVersion).toBe("1.0.21");
	expect(v.observe("", "", image).currentVersion).toBe("1.0.21");
	v.readback("a", "1.0.18");
	expect(v.observe("a", "", image).currentVersion).toBe("1.0.18");
});

it("invalidates readback precedence for a reconnected hardware session even after a downgrade", () => {
	const v = firmwareVersions();
	v.readback("a", "1.0.21", "session-1");
	expect(v.observe("a", "1.0.19", image, "session-1").currentVersion).toBe(
		"1.0.21",
	);
	v.observe("", "", image);
	expect(v.observe("a", "1.0.19", image, "session-2")).toMatchObject({
		currentVersion: "1.0.19",
		firmwareAvailability: "newer_bundled",
	});
});
