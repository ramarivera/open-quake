import { useEffect, useState } from "react";
import type { PublicModelRow } from "../../../../shared/agents";
import type { DirectChatBridge } from "../../../../shared/chat";
import type { createChatController } from "./controller";
import { type DirectChatModel, directChatModel } from "./model-scope";

/** Read the same host-owned persona used at admission, including selected-session updates. */
export function useEffectiveChatModel(
	bridge: DirectChatBridge | undefined,
	controller: ReturnType<typeof createChatController>,
	models: Readonly<Record<string, readonly PublicModelRow[]>> | undefined,
	fallback: DirectChatModel,
	sessionId: string,
	navigating: boolean,
) {
	const [resolved, setResolved] = useState<{
		readonly sessionId: string;
		readonly epoch: number;
		readonly models: typeof models;
		readonly model?: DirectChatModel;
		readonly failed?: boolean;
	}>();
	const epoch = controller.navigationEpoch();
	useEffect(() => {
		if (!models || !bridge?.persona || navigating) return;
		let alive = true;
		let timer: ReturnType<typeof setTimeout>;
		const read = async () => {
			try {
				const selected = await bridge.selection?.();
				if (!alive || controller.navigationEpoch() !== epoch) return;
				if (selected && selected.sessionId !== sessionId) {
					setResolved(undefined);
					return;
				}
				const settings = await bridge.persona?.read();
				const latest = await bridge.selection?.();
				if (
					!alive ||
					controller.navigationEpoch() !== epoch ||
					(latest?.generation ?? null) !== (selected?.generation ?? null)
				)
					return;
				setResolved({
					sessionId,
					epoch,
					models,
					model: directChatModel(models, settings, !!selected),
				});
			} catch {
				if (alive && controller.navigationEpoch() === epoch)
					setResolved({
						sessionId,
						epoch,
						models,
						failed: true,
					});
			} finally {
				if (alive)
					timer = setTimeout(() => {
						void read();
					}, 300);
			}
		};
		void read();
		return () => {
			alive = false;
			clearTimeout(timer);
		};
	}, [bridge, controller, models, sessionId, navigating, epoch]);
	if (!models || !bridge?.persona)
		return { model: fallback, loading: false, failed: false };
	const current =
		resolved?.sessionId === sessionId &&
		resolved.epoch === epoch &&
		resolved.models === models
			? resolved
			: undefined;
	return {
		model: current?.model ?? { ready: false, row: undefined },
		loading: navigating || !current,
		failed: current?.failed,
	};
}
