import { Schema } from "effect";
import { useEffect, useState } from "react";
import { ProfileEnvelope } from "../../../../../../packages/device/src/profiles/profile-contracts";
import { visibleProfiles } from "../../../../../../packages/device/src/profiles/profile-manager-invariants";
import type {
	AgentConnectionsBridge,
	AgentConnectionView,
} from "../../../shared/agent-connections";
import {
	type HardwareBridge,
	HardwareResponse,
} from "../../../shared/hardware-contracts";
import type { ProfileBridge } from "../../../shared/profile-manager";

/**
 * Read-only views of the canonical owners. Setup never configures a device,
 * creates a profile or starts a runtime; it only offers what they report.
 */
export type DisplayChoices =
	| {
			readonly state: "connected";
			readonly serial: string;
			readonly mock: boolean;
	  }
	| { readonly state: "offline" | "unavailable" | "failed" };

export async function readDisplay(
	bridge: HardwareBridge | undefined,
): Promise<DisplayChoices> {
	if (!bridge) return { state: "unavailable" };
	try {
		const reply = Schema.decodeUnknownOption(HardwareResponse)(
			await bridge.request({ _tag: "read" }),
		);
		if (reply._tag === "None") return { state: "failed" };
		const value = reply.value;
		if (value._tag === "offline") return { state: "offline" };
		if (value._tag === "failure") return { state: "failed" };
		return value.snapshot.available
			? { state: "connected", serial: value.snapshot.serial, mock: value.mock }
			: { state: "offline" };
	} catch {
		return { state: "failed" };
	}
}

export type ProfileChoice = { readonly id: string; readonly name: string };
export type ProfileChoices =
	| {
			readonly state: "ready";
			readonly profiles: ReadonlyArray<ProfileChoice>;
			/** Active profile per device serial, including "desktop-preview". */
			readonly active: Readonly<Record<string, string>>;
	  }
	| { readonly state: "unavailable" | "failed" };

export async function readProfiles(
	bridge: ProfileBridge | undefined,
	locale: "en" | "de",
): Promise<ProfileChoices> {
	if (!bridge) return { state: "unavailable" };
	try {
		// A preview read never changes the profile owner's locale.
		const reply = await bridge.request({ type: "read", locale, preview: true });
		if (reply._tag !== "success") return { state: "failed" };
		const decoded = Schema.decodeUnknownEither(ProfileEnvelope)(
			reply.view.envelope,
		);
		if (decoded._tag === "Left") return { state: "failed" };
		const envelope = decoded.right;
		return {
			state: "ready",
			// The manager's own visibility rule, as the root validates it.
			profiles: visibleProfiles(envelope).map((profile) => ({
				id: profile.id,
				name: profile.name,
			})),
			active: Object.fromEntries(
				Object.entries(envelope.activeByDevice).map(([serial, selection]) => [
					serial,
					selection.profileId,
				]),
			),
		};
	} catch {
		return { state: "failed" };
	}
}

/**
 * Optional runtime as the root validates it: supported while the agent
 * connection owner exists, configured once any HTTP connection is saved.
 * Selection and live connectivity are separate facts setup never probes.
 */
export type RuntimeChoice =
	| { readonly state: "unsupported" | "supported" }
	| { readonly state: "configured"; readonly count: number };

export function runtimeChoice(
	connections: AgentConnectionsBridge | undefined,
	view: AgentConnectionView | null,
): RuntimeChoice {
	if (!connections) return { state: "unsupported" };
	const count = view?.connections.length ?? 0;
	return count > 0 ? { state: "configured", count } : { state: "supported" };
}

/** The saved connection list via its read-only "list" command and snapshots. */
export function useRuntimeChoice(): RuntimeChoice {
	const bridge =
		typeof window !== "undefined" && "quakeAgentConnections" in window
			? window.quakeAgentConnections
			: undefined;
	const [view, setView] = useState<AgentConnectionView | null>(null);
	useEffect(() => {
		if (!bridge) return;
		let active = true;
		const accept = (next: AgentConnectionView) => {
			if (active)
				setView((current) =>
					!current || next.revision >= current.revision ? next : current,
				);
		};
		const off = bridge.onSnapshot(accept);
		void bridge
			.request({ type: "list" })
			.then((reply) => {
				if (reply._tag === "success") accept(reply.view);
			})
			.catch(() => {});
		return () => {
			active = false;
			off();
		};
	}, [bridge]);
	return runtimeChoice(bridge, view);
}
