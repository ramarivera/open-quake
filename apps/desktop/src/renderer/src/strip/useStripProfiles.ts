import { Either, Schema } from "effect";
import { useEffect, useState } from "react";
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

export function useStripProfiles(): StripProfiles {
	const [profiles, setProfiles] = useState<StripProfiles>({ _tag: "loading" });
	useEffect(() => {
		const bridge = window.quakeProfiles;
		if (!bridge) return;
		const off = subscribeStripProfiles(bridge, setProfiles);
		const preview = window.quakeKeyLibrary?.onPreview((snapshot) => {
			const decoded = Schema.decodeUnknownEither(ProfileEnvelope)(
				snapshot.envelope,
			);
			if (Either.isRight(decoded))
				setProfiles({ _tag: "ready", envelope: decoded.right });
		});
		return () => {
			off();
			preview?.();
		};
	}, []);
	return profiles;
}
