import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { AppLocaleProvider } from "../i18n";
import { defaultAppearance } from "../theme/appearance";
import type { AppearanceController } from "../theme/useAppearance";
import { PageHeader } from "../ui/Form";
import { ManagementShell } from "./ManagementShell";

afterEach(() => vi.unstubAllGlobals());

const appearance = {
	appearance: defaultAppearance,
	setSidebarWidth: () => {},
	setFontScale: () => {},
	setTheme: () => {},
} as unknown as AppearanceController;

function render(narrow: boolean, page: "keys" | "agents" = "keys"): string {
	vi.stubGlobal("window", {
		matchMedia: () => ({
			matches: narrow,
			addEventListener: () => {},
			removeEventListener: () => {},
		}),
	});
	return renderToStaticMarkup(
		createElement(AppLocaleProvider, {
			bridge: undefined,
			// biome-ignore lint/correctness/noChildrenProp: the provider types children as a required prop, so createElement must receive it there.
			children: createElement(
				ManagementShell,
				{
					page,
					onOpen: () => {},
					connection: {
						tone: "simulated",
						label: "Simulated",
						headline: "Simulated QUAKE",
						detail: "Development mode.",
						link: null,
						code: null,
					},
					runtimeStatus: "unknown",
					runtimeLabel: "Checking agent runtime",
					appearance,
					contentRef: { current: null },
					deviceReady: false,
				},
				createElement(PageHeader, { title: "Keys" }),
			),
		}),
	);
}

it("labels every navigation row and marks exactly one current page", () => {
	const html = render(false);
	expect(html.match(/class="nav-item"/g)).toHaveLength(13);
	expect(html.match(/aria-current="page"/g)).toHaveLength(1);
	expect(html).toMatch(/data-nav-page="keys" aria-current="page"/);
	for (const label of ["Overview", "Knob profiles", "Agents", "Settings"])
		expect(html).toContain(`<span class="nav-label">${label}</span>`);
	// Breadcrumb, section kicker and the live device status.
	expect(html).toContain('<span class="mc-breadcrumb-section">Device</span>');
	expect(html).toContain('<span class="mc-page-kicker">Device</span>');
	expect(html).toMatch(/class="mc-device-chip"[^>]*role="status"/);
	expect(html).not.toContain("Management Center</span>");
});

it("keeps the stable hooks used by tests and smokes", () => {
	const html = render(false);
	expect(html).toContain('title="UI Settings"');
	expect(html).toContain('aria-label="Drag to resize sidebar"');
	expect(html).toMatch(
		/class="content-inner" data-page="keys" data-layout="wide"/,
	);
	expect(render(false, "agents")).toContain('data-layout="full"');
});

it("collapses to a labelled Menu drawer instead of an icon rail when narrow", () => {
	const wide = render(false);
	expect(wide).not.toContain("inert");
	const narrow = render(true);
	expect(narrow).toMatch(
		/<button[^>]*class="mc-menu-button" aria-expanded="false" aria-controls="mc-sidebar"/,
	);
	expect(narrow).toContain("<span>Menu</span>");
	expect(narrow).toMatch(
		/id="mc-sidebar"[^>]*data-drawer="closed"[^>]*inert=""/,
	);
	// Labels stay in the drawer; the closed drawer is inert, not icon-only.
	expect(narrow).toContain('<span class="nav-label">Keys</span>');
});
