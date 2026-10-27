import { Schema } from "effect";
import { useEffect, useState } from "react";
import { isBuiltinProfile } from "../../../../../../packages/device/src/profiles/profile-catalog";
import { ProfileEnvelope } from "../../../../../../packages/device/src/profiles/profile-contracts";
import { managerState } from "../../../../../../packages/device/src/profiles/profile-manager-invariants";
import type {
	AgentConnectionReply,
	AgentConnectionsBridge,
	AgentConnectionView,
} from "../../../shared/agent-connections";
import {
	type HardwareBridge,
	HardwareResponse,
} from "../../../shared/hardware-contracts";
import type { AppLocale } from "../../../shared/locale";
import type { ProfileBridge } from "../../../shared/profile-manager";

/**
 * Read views of canonical owners. Setup applies default visibility through the
 * profile manager; it never creates profiles or starts a runtime.
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
		if (value._tag !== "ready") return { state: "failed" };
		return value.snapshot.available
			? { state: "connected", serial: value.snapshot.serial, mock: value.mock }
			: { state: "offline" };
	} catch {
		return { state: "failed" };
	}
}

/**
 * Owner reads where only the newest request may land: a superseded or
 * cancelled reply (locale change, retry, unmount) is dropped.
 */
export function latestRead<T>(accept: (value: T) => void): {
	readonly run: (read: () => Promise<T>) => void;
	readonly cancel: () => void;
} {
	let request = 0;
	return {
		run: (read) => {
			const id = ++request;
			void read().then((value) => {
				if (id === request) accept(value);
			});
		},
		cancel: () => {
			request++;
		},
	};
}

export type ProfileChoice = {
	readonly id: string;
	readonly name: string;
	readonly enabled?: boolean;
};
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
	locale: AppLocale,
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
			profiles: envelope.profiles
				.filter(
					(profile) =>
						isBuiltinProfile(profile.id) &&
						!(navigator.platform.includes("Mac") && profile.id === "1-0"),
				)
				.map((profile) => ({
					id: profile.id,
					name: profile.name,
					enabled: !managerState(envelope).hidden.includes(profile.id),
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
 * The preload bridge always exists; only the root's explicit unavailable
 * reply says the owner was never initialized.
 */
export type RuntimeChoice =
	| { readonly state: "unsupported" | "supported" }
	| { readonly state: "configured"; readonly count: number };

export function runtimeChoice(
	connections: AgentConnectionsBridge | undefined,
	view: AgentConnectionView | null,
	unavailable = false,
): RuntimeChoice {
	if (!connections || unavailable) return { state: "unsupported" };
	const count = view?.connections.length ?? 0;
	return count > 0 ? { state: "configured", count } : { state: "supported" };
}

/**
 * Only this exact code means "no runtime owner". Storage or transport
 * failures of a live owner keep the step, where Skip still works.
 */
export function ownerUnavailable(reply: AgentConnectionReply): boolean {
	return (
		reply._tag === "rejected" &&
		reply.code === "AGENT.HTTP.CONNECTION.UNAVAILABLE"
	);
}

/** The saved connection list via its read-only "list" command and snapshots. */
export function useRuntimeChoice(): RuntimeChoice {
	const bridge =
		typeof window !== "undefined" && "quakeAgentConnections" in window
			? window.quakeAgentConnections
			: undefined;
	const [view, setView] = useState<AgentConnectionView | null>(null);
	const [unavailable, setUnavailable] = useState(false);
	useEffect(() => {
		if (!bridge) return;
		let active = true;
		const accept = (next: AgentConnectionView) => {
			if (!active) return;
			setUnavailable(false);
			setView((current) =>
				!current || next.revision >= current.revision ? next : current,
			);
		};
		const off = bridge.onSnapshot(accept);
		void bridge
			.request({ type: "list" })
			.then((reply) => {
				if (reply._tag === "success") accept(reply.view);
				else if (active && ownerUnavailable(reply)) setUnavailable(true);
			})
			.catch(() => {});
		return () => {
			active = false;
			off();
		};
	}, [bridge]);
	return runtimeChoice(bridge, view, unavailable);
}
