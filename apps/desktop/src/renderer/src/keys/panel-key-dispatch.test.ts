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
	await new Promise((resolve) => setTimeout(resolve, 0));
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

it("queues full tap pairs through slow and failed activations", async () => {
	const calls: string[] = [];
	let finish: (() => void) | undefined;
	const slow = new Promise<void>((resolve) => {
		finish = resolve;
	});
	const d = createPanelKeyDispatcher(
		() => active,
		async (command) => {
			if (command.type === "activate") {
				calls.push(command.kind);
				if (calls.length === 1) {
					await slow;
					throw new Error("Synthetic failure");
				}
			}
			return { _tag: "success" };
		},
	);
	for (let i = 0; i < 3; i++) {
		d.key({ keyCode: "1,1", keyAction: 0 });
		d.key({ keyCode: "1,1", keyAction: 1 });
	}
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(calls).toEqual(["press"]);
	finish?.();
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(calls).toEqual([
		"press",
		"release",
		"press",
		"release",
		"press",
		"release",
	]);
});

it("lets other keys complete while preserving order for a stalled key", async () => {
	const calls: string[] = [];
	let finish = () => {};
	const slow = new Promise<void>((resolve) => {
		finish = resolve;
	});
	const d = createPanelKeyDispatcher(
		() => active,
		async (command) => {
			if (command.type === "activate") {
				calls.push(`${command.keyCode}:${command.kind}`);
				if (command.keyCode === "1,1" && command.kind === "press") await slow;
			}
			return { _tag: "success" };
		},
	);
	try {
		for (const keyCode of ["1,1", "1,1", "1,2", "1,3"]) {
			d.key({ keyCode, keyAction: 0 });
			d.key({ keyCode, keyAction: 1 });
		}
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(calls).toEqual([
			"1,1:press",
			"1,2:press",
			"1,3:press",
			"1,2:release",
			"1,3:release",
		]);
		finish();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(calls.slice(5)).toEqual(["1,1:release", "1,1:press", "1,1:release"]);
	} finally {
		d.cancel();
		finish();
	}
});

it("cancels queued taps on disconnect while still releasing the in-flight press", async () => {
	const calls: string[] = [];
	let finish: (() => void) | undefined;
	const gate = new Promise<void>((resolve) => {
		finish = resolve;
	});
	const d = createPanelKeyDispatcher(
		() => active,
		async (command) => {
			if (command.type === "activate") {
				calls.push(command.kind);
				if (calls.length === 1) await gate;
			}
			return { _tag: "success" };
		},
	);
	for (let i = 0; i < 2; i++) {
		d.key({ keyCode: "1,1", keyAction: 0 });
		d.key({ keyCode: "1,1", keyAction: 1 });
	}
	await Promise.resolve();
	d.cancel();
	finish?.();
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(calls).toEqual(["press", "release"]);
});
