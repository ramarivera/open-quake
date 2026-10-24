import { Either, Schema } from "effect";
import { useEffect, useRef, useState } from "react";
import {
	ProfileSnapshotReply,
	type ProfilesBridge,
} from "../../../shared/profile-snapshot-contracts";
import type { ProfileEnvelope } from "../../../shared/profiles";

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
): () => void {
	let live = true;
	const accept = (value: unknown): void => {
		const reply = decode(value);
		if (live && Either.isRight(reply)) update(reply.right);
	};
	const off = bridge.onSnapshot(accept);
	bridge.read().then(accept, () => {
		if (live)
			update({
				_tag: "failure",
				code: "QUAKE.PROFILE.READ_FAILED",
				message: "Reading local profiles failed",
			});
	});
	return () => {
		live = false;
		off();
	};
}

export function useStripProfiles(
	onSnapshot?: (next: StripProfiles) => void,
): StripProfiles {
	const observer = useRef(onSnapshot);
	observer.current = onSnapshot;
	const [profiles, setProfiles] = useState<StripProfiles>({ _tag: "loading" });
	useEffect(() => {
		const bridge = window.quakeProfiles;
		if (!bridge) return;
		return subscribeStripProfiles(bridge, (next) => {
			// Observe each committed snapshot before React can batch multiple selections.
			observer.current?.(next);
			setProfiles(next);
		});
	}, []);
	return profiles;
}
