// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { KeyRuntimeState } from "../../../shared/key-library";
import { createInitialProfileEnvelope } from "../../../shared/profiles";
import { mount, settle } from "../../test/dom";
import { consoleProfile } from "../keys/console-profile";
import { StripScreen } from "./StripScreen";

const originalKeyLibrary = window.quakeKeyLibrary;
let close: (() => Promise<void>) | undefined;
afterEach(async () => {
	await close?.();
	close = undefined;
	window.quakeKeyLibrary = originalKeyLibrary;
	vi.unstubAllGlobals();
});
it("renders only observed volume for the current profile revision and keeps compact clock/input hit regions separate", async () => {
	const profile = consoleProfile("en", "Console");
	const envelope = {
		...createInitialProfileEnvelope(),
		profiles: [profile] as const,
	};
	let publish = (_state: KeyRuntimeState) => {};
	window.quakeKeyLibrary = {
		request: async () => ({ _tag: "success" }),
		onPreview: () => () => {},
		onRuntime: (receive) => {
			publish = receive;
			return () => {};
		},
	};
	const mounted = await mount(
		<StripScreen
			profiles={{ _tag: "ready", envelope }}
			showEmptyGridDashedBorder={false}
		/>,
	);
	close = mounted.close;
	expect(mounted.host.querySelector(".console-volume-value")?.textContent).toBe(
		"—%",
	);
	const reading = {
		deviceId: "desktop-preview",
		profileId: profile.id,
		pageId: "1",
		keyCode: "1,3",
		revision: profile.revision,
		volume: 42,
		muted: false,
	};
	await act(async () => publish(reading));
	await settle(() =>
		expect(
			mounted.host.querySelector(".console-volume-value")?.textContent,
		).toBe("42%"),
	);
	await act(async () =>
		publish({ ...reading, revision: profile.revision + 1, volume: 99 }),
	);
	expect(mounted.host.querySelector(".console-volume-value")?.textContent).toBe(
		"—%",
	);
	const clock = mounted.host.querySelector<HTMLElement>(
		'.strip-slot[data-key-code="1,1"][data-state="tile"]',
	);
	const input = mounted.host.querySelector<HTMLElement>(
		'.strip-slot[data-key-code="1,5"][data-state="tile"]',
	);
	expect(clock?.style.width).toBe("456px");
	expect(input?.style.width).toBe("936px");
	expect(
		mounted.host
			.querySelector(".clawbot-input")
			?.getAttribute("data-horizontal"),
	).toBe("true");
});
