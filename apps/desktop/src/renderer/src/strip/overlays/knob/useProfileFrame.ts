import { useEffect, useMemo, useState } from "react";
import type { KnobModelSnapshot } from "../../../../../shared/knob-contracts";
import { stripLayout } from "../../geometry";
import { selectStripPage } from "../../selection";
import type { StripProfiles } from "../../useStripProfiles";

/** A late profile payload cannot reveal the previous profile's controls. */
export function useProfileFrame(
	profiles: StripProfiles,
	knob: KnobModelSnapshot | undefined,
	serial: string | undefined,
) {
	const selected =
		profiles._tag === "ready"
			? selectStripPage(profiles.envelope, serial ?? "desktop-preview")
			: undefined;
	const committed = knob?.context.session;
	const matchingDevice =
		committed && committed.deviceId === (serial ?? "desktop-preview");
	const pending = Boolean(
		matchingDevice && selected && selected.profile.id !== committed.profileId,
	);
	const identity = pending
		? `${committed?.deviceId}/${committed?.profileId}`
		: undefined;
	const transition = useMemo(() => ({ identity }), [identity]);
	const [expired, setExpired] = useState<typeof transition>();
	useEffect(() => {
		if (!transition.identity) return;
		const timer = setTimeout(() => setExpired(transition), 2000);
		return () => clearTimeout(timer);
	}, [transition]);
	const colorful = knob?.context.profiles.find(
		(profile) => profile.id === committed?.profileId,
	)?.colorful;
	const previousColorful = selected
		? stripLayout(selected.profile, selected.page).vivid
		: false;
	return {
		pending,
		vivid: pending && Boolean(colorful || previousColorful),
		profiles:
			pending && expired === transition
				? {
						_tag: "failure" as const,
						code: "QUAKE.PROFILE.READ_FAILED",
						message: "Reading local profiles failed",
					}
				: profiles,
	};
}
