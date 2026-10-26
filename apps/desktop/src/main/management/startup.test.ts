import { beforeEach, expect, it, vi } from "vitest";
import { prepareDesktopStartup } from "./startup";

const host = vi.hoisted(() => ({
	appendSwitch: vi.fn(),
	setAppUserModelId: vi.fn(),
	text: '{"version":1,"locale":"de","revision":2}',
	size: 42,
}));
vi.mock("electron", () => ({
	app: {
		getPath: () => "/synthetic-user",
		setAppUserModelId: host.setAppUserModelId,
		commandLine: { appendSwitch: host.appendSwitch },
	},
}));
vi.mock("node:fs", () => ({
	statSync: () => ({ size: host.size }),
	readFileSync: () => host.text,
}));
beforeEach(() => {
	host.appendSwitch.mockClear();
	host.setAppUserModelId.mockClear();
	host.size = 42;
	host.text = '{"version":1,"locale":"de","revision":2}';
});
it("MAIN-119 configures platform identity and validated locale before windows", () => {
	prepareDesktopStartup("win32");
	expect(host.setAppUserModelId).toHaveBeenCalledWith(
		"net.roxasroot.open-quake",
	);
	expect(host.appendSwitch.mock.calls).toEqual([
		["disable-features", "CalculateNativeWinOcclusion"],
		["lang", "de"],
	]);
});
it.each(['{"locale":"../../private"}', "{", '{"locale":12}'])(
	"MAIN-119 ignores corrupt startup locale %s",
	(text) => {
		host.text = text;
		prepareDesktopStartup("darwin");
		expect(host.setAppUserModelId).not.toHaveBeenCalled();
		expect(host.appendSwitch).toHaveBeenCalledTimes(1);
	},
);
it("MAIN-119 bounds startup reads", () => {
	host.size = 65537;
	prepareDesktopStartup();
	expect(host.appendSwitch).toHaveBeenCalledTimes(1);
});
