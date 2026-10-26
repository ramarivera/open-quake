// @vitest-environment happy-dom
import { createElement } from "react";
import { expect, it, vi } from "vitest";
import { App } from "../App";
import { mount } from "./dom-test";

vi.mock("../keys/IconPicker", () => ({
	IconPickerSurface: () => <div data-route="icons" />,
}));
vi.mock("../strip/StripPanel", () => ({
	StripPanel: () => <div data-route="panel" />,
}));
vi.mock("../profiles/ProfileViews", () => ({
	ProfileThumbnail: () => <div data-route="profile-thumbnail" />,
	ProfilesManager: () => null,
}));
vi.mock("../meetings/CaptureHost", () => ({
	CaptureHost: () => <div data-route="meeting-capture" />,
}));
it.each(["icons", "panel", "profile-thumbnail", "meeting-capture"])(
	"MGMT-001 routes %s without management chrome",
	async (surface) => {
		window.history.replaceState(null, "", `/?surface=${surface}`);
		const view = await mount(createElement(App));
		try {
			expect(
				document.querySelector(`[data-route="${surface}"]`),
			).not.toBeNull();
			expect(document.querySelector(".management-window")).toBeNull();
			expect(document.querySelectorAll("[data-route]")).toHaveLength(1);
		} finally {
			await view.unmount();
		}
	},
);
