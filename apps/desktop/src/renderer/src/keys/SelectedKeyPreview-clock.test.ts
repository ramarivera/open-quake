import { Children, isValidElement } from "react";
import { expect, it, vi } from "vitest";
import type { ClockThemeResult } from "../strip/tiles/clock/themePreview";
import { ClockPreviewControls } from "./SelectedKeyPreview";

const clock = vi.hoisted(() => ({
	selectTheme: vi.fn<() => Promise<ClockThemeResult>>(),
}));
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useState: () => [false, () => {}],
	useRef: (current: unknown) => ({ current }),
}));
vi.mock("../strip/tiles/clock/useClockSettings", () => ({
	useClockSettings: () => ({ snapshot: {}, selectTheme: clock.selectTheme }),
	themeOf: () => "season",
}));
vi.mock("../strip/tileRegistry", () => ({ stripTileFor: vi.fn() }));
it.each([false, true])(
	"keeps delayed clock completion inside the current editor selection: %s",
	async (leave) => {
		let finish: (result: ClockThemeResult) => void = () => {};
		clock.selectTheme.mockReturnValue(
			new Promise((resolve) => {
				finish = resolve;
			}),
		);
		let current = true;
		const onSaved = vi.fn(async () => {});
		const controls = ClockPreviewControls({
			target: { profileId: "p", pageId: "one", keyCode: "1,1" },
			beforeWrite: async () => true,
			onSaved,
			isCurrent: () => current,
		});
		const next = Children.toArray(controls.props.children)[1];
		if (!isValidElement<{ onClick: () => void }>(next))
			throw new Error("Missing next button");
		next.props.onClick();
		expect(clock.selectTheme).toHaveBeenCalled();
		if (leave) current = false;
		finish({ ok: true });
		await clock.selectTheme.mock.results.at(-1)?.value;
		await Promise.resolve();
		expect(onSaved).toHaveBeenCalledTimes(leave ? 0 : 1);
	},
);
