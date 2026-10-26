import { Effect } from "effect";
import { AiConfigInvalid } from "../../../../../packages/edge/src/ai/ai-errors";
import { HomeAssistantService } from "../../../../../packages/edge/src/home-assistant/ha-service";
import type { DesktopRuntime } from "../diagnostics/module";
import type { AssistantHaPort } from "./assistant-ha";

/** The application bridge between the assistant worker and the integrations owner. */
export function createAssistantHaPort<R>(
	runtime: () => DesktopRuntime<R | HomeAssistantService>,
): AssistantHaPort {
	return {
		snapshot: () =>
			Effect.tryPromise({
				try: (signal) =>
					runtime().runPromise(HomeAssistantService.snapshot(), { signal }),
				catch: (cause) => new AiConfigInvalid(cause),
			}),
		execute: (key, isCurrent) =>
			Effect.tryPromise({
				try: (signal) =>
					runtime().runPromise(
						HomeAssistantService.execute(key, true, isCurrent),
						{ signal },
					),
				catch: (cause) => new AiConfigInvalid(cause),
			}),
	};
}
