import { expect, it } from "vitest";
import { localeFailureCode } from "./locale-error";

it.each([
	"QUAKE.SETTINGS.INVALID",
	"QUAKE.SETTINGS.READ_FAILED",
	"QUAKE.SETTINGS.PERSIST_FAILED",
	"QUAKE.SETTINGS.UNAVAILABLE",
])("retains projected locale identity %s", (code) => {
	expect(
		localeFailureCode({ code, message: "ignored private text" }, "fallback"),
	).toBe(code);
});
it.each([
	undefined,
	null,
	new Error("private text"),
	{ code: "private-token" },
])("keeps the operation fallback for unknown failures", (error) => {
	expect(localeFailureCode(error, "QUAKE.SETTINGS.READ_FAILED")).toBe(
		"QUAKE.SETTINGS.READ_FAILED",
	);
});
