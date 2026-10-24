import { validCityQuery } from "../../../shared/weather-invariants";
import type { CityResult } from "../../../shared/weather-media-contracts";

export type CityStatus = CityResult | { readonly _tag: "idle" | "checking" };
export class CityVerifier {
	private timer: ReturnType<typeof setTimeout> | undefined;
	private sequence = 0;
	constructor(
		private readonly search: (query: string) => Promise<CityResult>,
		private readonly publish: (status: CityStatus) => void,
		private readonly settled: (
			query: string,
			result: CityResult | null,
		) => void,
	) {}
	update(query: string): void {
		const sequence = ++this.sequence;
		clearTimeout(this.timer);
		this.publish({ _tag: "idle" });
		this.timer = setTimeout(() => {
			if (!query.trim()) {
				this.settled(query, null);
				return;
			}
			if (!validCityQuery(query)) {
				this.publish({ _tag: "not-found" });
				this.settled(query, { _tag: "not-found" });
				return;
			}
			this.publish({ _tag: "checking" });
			void this.search(query)
				.catch((): CityResult => ({ _tag: "network" }))
				.then((result) => {
					if (sequence !== this.sequence) return;
					this.publish(result);
					this.settled(query, result);
				});
		}, 600);
	}
	dispose(): void {
		this.sequence++;
		clearTimeout(this.timer);
	}
}
