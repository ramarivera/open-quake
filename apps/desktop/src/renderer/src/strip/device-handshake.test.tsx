// @vitest-environment happy-dom
import { Option, Schema } from "effect";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	quickProfile,
	stripFixtureEnvelope,
	vividProfile,
} from "../../../main/test/strip-fixtures";
import type { OpenQuakeBridge, QuakeEvent } from "../../../preload/quake";
import type { DeviceReadySnapshot } from "../../../shared/hardware-contracts";
import { ProfileEnvelope } from "../../../shared/profiles";
import {
	initialStripProfile,
	selectStripPage,
} from "../../../shared/strip-selection";
import type { StripMessage } from "../../../shared/strip-transport";
import { stripLayout } from "./geometry";
import { useDeviceReady } from "./useDeviceReady";
import { useStripProfiles } from "./useStripProfiles";

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
const roots: Root[] = [];
const listeners = new Set<(event: QuakeEvent) => void>();
function host() {
	const node = document.createElement("div");
	document.body.append(node);
	const root = createRoot(node);
	roots.push(root);
	return { node, root };
}
function events(): OpenQuakeBridge {
	return {
		version: "0.0.0",
		onQuakeEvent: (callback) => {
			listeners.add(callback);
			return () => {
				listeners.delete(callback);
			};
		},
	};
}
function emit(event: QuakeEvent) {
	for (const listener of listeners) listener(event);
}
function snapshot(serial = "A", version = "1.0.21"): DeviceReadySnapshot {
	return {
		serialNumber: serial,
		connected: true,
		deviceModel: "QUAKE_HID",
		connectionType: "HID",
		session: `session-${serial}`,
		version,
		rotation: 90,
		keyMatrix: { row: 2, col: 8 },
	};
}
const envelope = (revision: number) => {
	const value = stripFixtureEnvelope(quickProfile, "A");
	return {
		...value,
		profiles: value.profiles.map((p) =>
			p.id === quickProfile.id ? { ...p, revision } : p,
		),
	};
};
const decode = Schema.decodeUnknownSync(ProfileEnvelope);
afterEach(async () => {
	await act(async () => {
		for (const root of roots.splice(0)) root.unmount();
	});
	document.body.replaceChildren();
	listeners.clear();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

it("SCREEN-009/013 subscribes before readiness and reports config before the active profile for each identity", async () => {
	vi.stubGlobal("openQuake", events());
	let current = snapshot();
	const read = vi.fn(async () => {
		expect(listeners.size).toBe(1);
		return { _tag: "ready", snapshot: current };
	});
	vi.stubGlobal("quakeDeviceReady", { read });
	const sent: StripMessage[] = [];
	let release: () => void = () => {};
	let block = true;
	vi.stubGlobal("quakeStripTransport", {
		send: vi.fn(async (_session: string, message: StripMessage) => {
			sent.push(message);
			if (message.type === "reportConfig" && block)
				await new Promise<void>((resolve) => {
					release = resolve;
				});
			return { ok: true };
		}),
	});
	function Panel({ serial }: { serial: string }) {
		const state = useDeviceReady(serial, {
			_tag: "ready",
			envelope: decode(envelope(1)),
		});
		return (
			<output>
				{state.snapshot?.serialNumber}:{state.snapshot?.version}
			</output>
		);
	}
	const { root, node } = host();
	await act(async () => {
		root.render(<Panel serial="A" />);
	});
	expect(sent).toEqual([
		{
			type: "reportConfig",
			keyMatrix: { row: 2, col: 8 },
			appVersion: "0.0.0",
		},
	]);
	block = false;
	await act(async () => {
		release();
	});
	expect(sent[1]).toMatchObject({
		type: "reportActiveProfile",
		resourceId: quickProfile.id,
		version: 1,
	});
	await act(async () => {
		emit({ source: "hid", kind: "status", state: "connected" });
	});
	expect(sent).toHaveLength(2);
	current = snapshot("A", "2.0.1");
	await act(async () => {
		emit({ source: "hid", kind: "status", state: "connected" });
	});
	expect(node.textContent).toBe("A:2.0.1");
	expect(sent).toHaveLength(4);
	current = { ...current, keyMatrix: { row: 1, col: 8 } };
	await act(async () => {
		emit({
			source: "hid",
			kind: "json",
			value: { type: "reportConfig", keyMatrix: { row: 1, col: 5 } },
		});
	});
	expect(sent).toHaveLength(6);

	current = snapshot("B");
	await act(async () => {
		root.render(<Panel serial="B" />);
	});
	expect(node.textContent).toBe("B:1.0.21");
	expect(sent).toHaveLength(8);
	expect(listeners.size).toBe(1);
	await act(async () => {
		root.unmount();
		roots.splice(roots.indexOf(root), 1);
	});
	expect(listeners.size).toBe(0);
});

it("SCREEN-019 mounted strip retains newer pushes, refreshes only the active resource and discards obsolete reads", async () => {
	vi.stubGlobal("openQuake", events());
	const reads: Array<(reply: unknown) => void> = [];
	let push: (reply: unknown) => void = () => {};
	const off = vi.fn();
	const read = vi.fn(
		() => new Promise<unknown>((resolve) => reads.push(resolve)),
	);
	vi.stubGlobal("quakeProfiles", {
		read,
		onSnapshot: (callback: typeof push) => {
			push = callback;
			return off;
		},
	});
	function Panel() {
		const value = useStripProfiles(undefined, "A");
		return (
			<output>
				{value._tag === "ready"
					? value.envelope.profiles.find((p) => p.id === quickProfile.id)
							?.revision
					: value._tag}
			</output>
		);
	}
	const { root, node } = host();
	await act(async () => {
		root.render(<Panel />);
	});
	await act(async () => {
		push({ _tag: "ready", envelope: envelope(2) });
		reads[0]?.({ _tag: "ready", envelope: envelope(1) });
	});
	expect(node.textContent).toBe("2");
	await act(async () => {
		push({ _tag: "ready", envelope: envelope(1) });
	});
	expect(node.textContent).toBe("2");
	await act(async () => {
		emit({
			source: "hid",
			kind: "json",
			value: { type: "configSync", resourceId: "inactive" },
		});
		reads[1]?.({ _tag: "ready", envelope: envelope(3) });
	});
	expect(node.textContent).toBe("2");
	await act(async () => {
		emit({
			source: "hid",
			kind: "json",
			value: { type: "configSync", resourceId: quickProfile.id },
		});
		reads[2]?.({ _tag: "ready", envelope: envelope(3) });
	});
	expect(node.textContent).toBe("3");
	await act(async () => {
		emit({
			source: "hid",
			kind: "json",
			value: { type: "configSync", resourceId: quickProfile.id },
		});
		push({ _tag: "ready", envelope: envelope(5) });
		reads[3]?.({ _tag: "ready", envelope: envelope(4) });
	});
	expect(node.textContent).toBe("5");
	await act(async () => {
		root.unmount();
		roots.splice(roots.indexOf(root), 1);
	});
	expect(off).toHaveBeenCalledOnce();
	expect(listeners.size).toBe(0);
});

it("SCREEN-018/144 chooses a visible colorful profile and filters only the negotiated view", () => {
	const value = decode(stripFixtureEnvelope());
	const colorful = value.profiles.find((p) => p.id === vividProfile.id);
	expect(colorful).toBeDefined();
	expect(initialStripProfile(value).id).toBe(vividProfile.id);
	if (Option.isSome(value.manager)) {
		const hidden = {
			...value,
			manager: Option.some({
				...value.manager.value,
				hidden: [vividProfile.id],
			}),
		};
		expect(initialStripProfile(hidden).id).not.toBe(vividProfile.id);
	}
	const profile = value.profiles.find((p) => p.id === quickProfile.id);
	if (!profile) throw new Error("Missing fixture");
	const page = profile.pages[0];
	const before = JSON.stringify(page);
	const full = stripLayout(profile, page, 2);
	const single = stripLayout(profile, page, 1);
	expect(single.tiles.length).toBeLessThan(full.tiles.length);
	expect(single.tiles.every((tile) => tile.keyCode.startsWith("1,"))).toBe(
		true,
	);
	expect(JSON.stringify(page)).toBe(before);
});

it("SCREEN-018 never reports a transient emoji-back page as a persisted active profile", async () => {
	vi.stubGlobal("openQuake", events());
	vi.stubGlobal("quakeDeviceReady", {
		read: async () => ({ _tag: "ready", snapshot: snapshot() }),
	});
	const send = vi.fn(async () => ({ ok: true }));
	vi.stubGlobal("quakeStripTransport", { send });
	const source = envelope(2);
	const transient = decode({
		...source,
		profiles: source.profiles.map((profile) =>
			profile.id !== quickProfile.id
				? profile
				: {
						...profile,
						pages: profile.pages.map((page) => ({
							...page,
							keys: page.keys.map((key, index) =>
								index
									? key
									: { ...key, config: { ...key.config, type: "emojiBack" } },
							),
						})),
					},
		),
	});
	function Panel() {
		useDeviceReady("A", { _tag: "ready", envelope: transient });
		return null;
	}
	const { root } = host();
	await act(async () => {
		root.render(<Panel />);
	});
	expect(send).toHaveBeenCalledExactlyOnceWith("session-A", {
		type: "reportConfig",
		keyMatrix: { row: 2, col: 8 },
		appVersion: "0.0.0",
	});
});

it("SCREEN-018 first-run panel and outbound handshake select the same colorful profile", async () => {
	vi.stubGlobal("openQuake", events());
	vi.stubGlobal("quakeDeviceReady", {
		read: async () => ({ _tag: "ready", snapshot: snapshot() }),
	});
	const send = vi.fn(async () => ({ ok: true }));
	vi.stubGlobal("quakeStripTransport", { send });
	const value = { ...decode(stripFixtureEnvelope()), activeByDevice: {} };
	function Panel() {
		useDeviceReady("A", { _tag: "ready", envelope: value });
		return <output>{selectStripPage(value, "A").profile.id}</output>;
	}
	const { root, node } = host();
	await act(async () => root.render(<Panel />));
	expect(node.textContent).toBe(vividProfile.id);
	expect(send).toHaveBeenLastCalledWith("session-A", {
		type: "reportActiveProfile",
		resourceId: node.textContent,
		version: vividProfile.revision,
	});
});
