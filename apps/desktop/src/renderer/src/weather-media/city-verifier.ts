import { validCityQuery } from "../../../shared/weather-invariants";
import type { CityResult } from "../../../shared/weather-media-contracts";

export type CityStatus = CityResult | { readonly _tag: "idle" | "checking" };
export class CityVerifier {
	private timer: ReturnType<typeof setTimeout> | undefined;
	private sequence = 0;
	constructor(
		private readonly search: (query: string) => Promise<CityResult>,
		private readonly publish: (status: CityStatus) => void,
		private readonly matched: (
			result: Extract<CityResult, { _tag: "matched" }>,
		) => void,
	) {}
	update(query: string): void {
		const sequence = ++this.sequence;
		clearTimeout(this.timer);
		this.publish({ _tag: "idle" });
		if (!query.trim()) return;
		this.timer = setTimeout(() => {
			if (!validCityQuery(query)) {
				this.publish({ _tag: "not-found" });
				return;
			}
			this.publish({ _tag: "checking" });
			void this.search(query)
				.catch((): CityResult => ({ _tag: "network" }))
				.then((result) => {
					if (sequence !== this.sequence) return;
					this.publish(result);
					if (result._tag === "matched") this.matched(result);
				});
		}, 600);
	}
	dispose(): void {
		this.sequence++;
		clearTimeout(this.timer);
	}
}
