import { useCallback, useRef, useState } from "react";
import type {
	IntegrationReply,
	IntegrationRequest,
} from "../../../../shared/integrations";
import { shortcutMessages } from "./strings";
export function useIntegrations() {
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const pending = useRef(0);
	const request = useCallback(
		async (
			command: IntegrationRequest,
		): Promise<IntegrationReply | undefined> => {
			const bridge = window.quakeIntegrations;
			if (!bridge) {
				setError("Integration service is unavailable");
				return;
			}
			pending.current++;
			setBusy(true);
			setError("");
			try {
				const reply = await bridge.request(command);
				if (reply.type === "error") {
					const shortcutError = command.type.startsWith("shortcuts.")
						? reply.code === "INTEGRATION.DRAFT.UNAVAILABLE"
							? shortcutMessages.unavailable
							: reply.field === "Invalid configuration"
								? shortcutMessages.invalidConfig
								: reply.field === "Invalid name"
									? shortcutMessages.invalidName
									: reply.field === "This library has no shortcuts"
										? shortcutMessages.emptyLibrary
										: undefined
						: undefined;
					setError(
						shortcutError ??
							[reply.message, reply.field].filter(Boolean).join(": "),
					);
					return;
				}
				return reply;
			} catch {
				setError("Integration service is unavailable");
				return;
			} finally {
				pending.current--;
				setBusy(pending.current > 0);
			}
		},
		[],
	);
	return { request, error, setError, busy };
}
