import { Schema } from "effect";
import { emptyKnobResource } from "../../../../../../packages/device/src/knob/knob-invariants";
import {
	createEmptyProfileKey,
	ProfileEnvelope,
	ProfileKey,
} from "../../../../../../packages/device/src/profiles/profile-contracts";

/** The fixture owns fresh userData. Tiles only select their current page. */
export function guidedProfileEnvelope() {
	return Schema.decodeUnknownSync(ProfileEnvelope)({
		schemaVersion: 1,
		clockConfigVersion: 1,
		profiles: [
			{
				id: "guided-capture",
				name: "Touch capture",
				revision: 0,
				pages: [
					{
						id: "1",
						keys: Array.from({ length: 16 }, (_, i) => {
							const row = Math.floor(i / 8) + 1,
								col = (i % 8) + 1;
							const key = Schema.encodeSync(ProfileKey)(
								createEmptyProfileKey(`${row},${col}`),
							);
							return {
								...key,
								childrenName: "pageNo",
								config: {
									...key.config,
									type: "pageNo",
									actions: [],
									userModifiedTitle: true,
									title: {
										...key.config.title,
										text: `${row} · ${col}`,
										display: true,
										pos: "mid",
										style: "",
									},
								},
							};
						}),
					},
				],
				knob: emptyKnobResource(),
			},
		],
		activeByDevice: {},
		manager: {
			revision: 0,
			installed: true,
			hidden: [],
			startup: "guided-capture",
			userHasSetDefault: true,
			links: [],
			approvedCommands: [],
		},
	});
}
