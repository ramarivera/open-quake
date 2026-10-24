import { expect, it } from "vitest";
import type { KeyRequest } from "../../../shared/key-library";
import { createPanelKeyDispatcher } from "./panel-key-dispatch";

const active = {
	deviceId: "selected-serial",
	profileId: "profile",
	pageId: "page",
	revision: 3,
};
it("dispatches a completed tap with the original serial and snapshot, then releases", async () => {
	const calls: KeyRequest[] = [];
	let target = active;
	const d = createPanelKeyDispatcher(
		() => target,
		async (command) => {
			calls.push(command);
			return { _tag: "success" };
		},
	);
	d.key({ keyCode: "1,1", keyAction: 0 });
	expect(calls).toEqual([]);
	target = { ...active, revision: 4 };
	d.key({ keyCode: "1,1", keyAction: 1 });
	await Promise.resolve();
	expect(calls).toEqual([
		{ ...active, type: "activate", keyCode: "1,1", kind: "press" },
		{ ...active, type: "activate", keyCode: "1,1", kind: "release" },
	]);
});
it("cancels a swipe, disconnect, overlay or disposed contact without host activation", () => {
	const calls: KeyRequest[] = [];
	const d = createPanelKeyDispatcher(
		() => active,
		async (command) => {
			calls.push(command);
			return { _tag: "success" };
		},
	);
	d.key({ keyCode: "1,1", keyAction: 0 });
	d.cancel();
	d.key({ keyCode: "1,1", keyAction: 1 });
	expect(calls).toEqual([]);
});
