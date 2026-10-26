import { Either, Schema } from "effect";
import { useEffect, useRef, useState } from "react";
import {
	ProfileSnapshotReply,
	type ProfilesBridge,
} from "../../../shared/profile-snapshot-contracts";
import { ProfileEnvelope } from "../../../shared/profiles";

export type StripProfiles =
	| { readonly _tag: "loading" }
	| { readonly _tag: "ready"; readonly envelope: ProfileEnvelope }
	| {
			readonly _tag: "failure";
			readonly code: string;
			readonly message: string;
	  };

const decode = Schema.decodeUnknownEither(ProfileSnapshotReply);

/** Decodes every reply; malformed payloads are dropped, never rendered. */
export function subscribeStripProfiles(
	bridge: ProfilesBridge,
	update: (next: StripProfiles) => void,
	serial?: string,
): (() => void) & { refresh(resourceId: string): void } {
	let live = true;
	let pushed = false;
	let epoch = 0;
	let current: ProfileEnvelope | undefined;
	const accept = (value: unknown): void => {
		const reply = decode(value);
		if (!live || Either.isLeft(reply)) return;
		if (reply.right._tag === "ready") {
			const next = reply.right.envelope;
			if (
				current &&
				((current.manager._tag === "Some" &&
					next.manager._tag === "Some" &&
					next.manager.value.revision < current.manager.value.revision) ||
					next.profiles.some(
						(p) =>
							(current?.profiles.find((old) => old.id === p.id)?.revision ??
								-1) > p.revision,
					))
			)
				return;
			current = next;
		}
		update(reply.right);
	};
	const off = bridge.onSnapshot((value) => {
		if (decode(value)._tag !== "Right") return;
		pushed = true;
		epoch++;
		accept(value);
	});
	bridge.read().then(
		(value) => {
			if (!pushed) accept(value);
		},
		() => {
			if (live && !pushed)
				update({
					_tag: "failure",
					code: "QUAKE.PROFILE.READ_FAILED",
					message: "Reading local profiles failed",
				});
		},
	);
	return Object.assign(
		() => {
			live = false;
			epoch++;
			off();
		},
		{
			refresh(resourceId: string): void {
				if (!live) return;
				const requested = epoch;
				void bridge.read().then(
					(value) => {
						if (!live || epoch !== requested) return;
						const reply = decode(value);
						if (reply._tag !== "Right" || reply.right._tag !== "ready") return;
						const active = serial
							? (current ?? reply.right.envelope).activeByDevice[serial]
									?.profileId
							: undefined;
						if (active === resourceId) accept(value);
					},
					() => {},
				);
			},
		},
	);
}

export function useStripProfiles(
	onSnapshot?: (next: StripProfiles) => void,
	serial?: string,
): StripProfiles {
	const observer = useRef(onSnapshot);
	observer.current = onSnapshot;
	const [profiles, setProfiles] = useState<StripProfiles>({ _tag: "loading" });
	useEffect(() => {
		const bridge = window.quakeProfiles;
		if (!bridge) return;
		const update = (next: StripProfiles): void => {
			observer.current?.(next);
			setProfiles(next);
		};
		const off = subscribeStripProfiles(bridge, update, serial);
		const offMessages = window.openQuake?.onQuakeEvent((event) => {
			if (
				event.kind !== "json" ||
				typeof event.value !== "object" ||
				event.value === null ||
				Array.isArray(event.value)
			)
				return;
			const message = Schema.decodeUnknownOption(
				Schema.Struct({
					type: Schema.Literal("configSync"),
					resourceId: Schema.String,
				}),
			)(event.value);
			if (message._tag === "None") return;
			off.refresh(message.value.resourceId);
		});
		const preview = window.quakeKeyLibrary?.onPreview((snapshot) => {
			const decoded = Schema.decodeUnknownEither(ProfileEnvelope)(
				snapshot.envelope,
			);
			if (Either.isRight(decoded))
				update({ _tag: "ready", envelope: decoded.right });
		});
		return () => {
			off();
			offMessages?.();
			preview?.();
		};
	}, [serial]);
	return profiles;
}
