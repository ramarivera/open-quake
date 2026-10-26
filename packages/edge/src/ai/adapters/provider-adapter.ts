import { Effect } from "effect";
import { AiUnavailable } from "../ai-errors.js";
import type { CompatibleAdapter } from "./adapter.js";
import { makeCozeAdapter } from "./coze.js";
import { makeDashscopeMediaAdapter } from "./dashscope-media.js";
import type { AiToolBridge } from "./tool-bridge.js";
import { makeVercelCompatibleAdapter } from "./vercel.js";
import { makeSparkAdapter, type SparkConnect } from "./xfy.js";
/** One explicit dispatch registry. Never dispatch by model-name guesses. */
export function makeProviderAdapter(
	fetcher: typeof fetch = globalThis.fetch,
	spark?: SparkConnect,
	bridge?: typeof AiToolBridge.Service,
): CompatibleAdapter {
	const compatible = makeVercelCompatibleAdapter(fetcher, bridge);
	const media = makeDashscopeMediaAdapter(fetcher);
	const coze = makeCozeAdapter(fetcher);
	const xfy = spark ? makeSparkAdapter(spark) : undefined;
	return {
		open: Effect.fn("ProviderAdapter.open")((input) => {
			switch (input.profile.adapter) {
				case "openai-compatible":
					return compatible.open(input);
				case "dashscope-media":
					return media.open(input);
				case "coze":
					return coze.open(input);
				case "xfy":
					return xfy ? xfy.open(input) : Effect.fail(new AiUnavailable());
				default:
					return Effect.fail(new AiUnavailable());
			}
		}),
	};
}
