import { Schema } from "effect";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DeviceReadySnapshot } from "../../../shared/hardware-contracts";
import {
	initialStripProfile,
	isTransientStripPage,
	selectStripPage,
} from "../../../shared/strip-selection";
import type { StripMessage } from "../../../shared/strip-transport";
import { createStripDeviceSession } from "./device-session";
import type { StripProfiles } from "./useStripProfiles";

const matrixReport = Schema.Struct({
	type: Schema.Literal("reportConfig"),
	keyMatrix: Schema.Struct({ row: Schema.Literal(1, 2), col: Schema.Number }),
});

export function useDeviceReady(
	serial: string | undefined,
	profiles: StripProfiles,
) {
	const [snapshot, setSnapshot] = useState<DeviceReadySnapshot>();
	const report = useRef<string | undefined>(undefined);
	const recovery = useRef<
		ReturnType<typeof createStripDeviceSession> | undefined
	>(undefined);
	useEffect(() => {
		setSnapshot(undefined);
		const bridge = window.quakeDeviceReady;
		if (!bridge) return;
		const session = createStripDeviceSession({
			bridge,
			serial,
			ready: setSnapshot,
			schedule: (work, delay) => {
				const timer = setTimeout(work, delay);
				return () => clearTimeout(timer);
			},
		});
		recovery.current = session;
		const off = window.openQuake?.onQuakeEvent((event) => {
			if (event.kind === "json" && Schema.is(matrixReport)(event.value))
				session.recover();
			if (event.kind === "status") {
				if (event.state === "connected") session.recover();
				else {
					setSnapshot(undefined);
					session.lost();
				}
			}
		});
		session.start();
		return () => {
			off?.();
			session.close();
			recovery.current = undefined;
			report.current = undefined;
		};
	}, [serial]);
	const send = useCallback(
		async (message: StripMessage): Promise<boolean> => {
			if (
				(serial && snapshot?.serialNumber !== serial) ||
				!snapshot?.session ||
				!window.quakeStripTransport
			)
				return false;
			try {
				const reply = await window.quakeStripTransport.send(
					snapshot.session,
					message,
				);
				if (!reply.ok) {
					report.current = undefined;
					setSnapshot(undefined);
					recovery.current?.lost();
				}
				return reply.ok;
			} catch {
				report.current = undefined;
				setSnapshot(undefined);
				recovery.current?.lost();
				return false;
			}
		},
		[snapshot, serial],
	);
	useEffect(() => {
		if (
			(serial && snapshot?.serialNumber !== serial) ||
			!snapshot?.session ||
			profiles._tag !== "ready"
		)
			return;
		const profile = profiles.envelope.activeByDevice[snapshot.serialNumber]
			? selectStripPage(profiles.envelope, snapshot.serialNumber).profile
			: initialStripProfile(profiles.envelope);
		const identity = JSON.stringify([
			snapshot.serialNumber,
			snapshot.session,
			snapshot.version,
			snapshot.rotation,
			snapshot.keyMatrix.row,
			profile.id,
			profile.revision,
		]);
		if (report.current === identity) return;
		report.current = identity;

		void (async () => {
			if (
				!(await send({
					type: "reportConfig",
					keyMatrix: { row: 2, col: 8 },
					appVersion: window.openQuake?.version ?? "",
				}))
			)
				return;
			if (
				report.current !== identity ||
				isTransientStripPage(
					profile,
					profiles.envelope.activeByDevice[snapshot.serialNumber]?.pageId,
				)
			)
				return;
			await send({
				type: "reportActiveProfile",
				resourceId: profile.id,
				version: profile.revision,
			});
		})();
	}, [snapshot, profiles, send, serial]);
	return {
		snapshot:
			serial && snapshot?.serialNumber !== serial ? undefined : snapshot,
		send,
	};
}
