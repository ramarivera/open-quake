import { Context, type Effect } from "effect";
/** Host state only. No DNS/HTTP probe, renderer override or global connectivity cache. */
export class AiConnectivity extends Context.Tag(
	"@open-quake/edge/AiConnectivity",
)<AiConnectivity, { readonly online: () => Effect.Effect<boolean> }>() {}
