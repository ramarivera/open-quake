import type { WallpaperSnapshot } from "../../../shared/wallpaper-contracts";

export interface WallpaperLayer {
	readonly id: number;
	readonly index: number;
	readonly asset: WallpaperSnapshot["asset"];
	readonly snapshot: WallpaperSnapshot;
	readonly state: "active" | "preload" | "retired";
}
/** At most two native media elements. Readiness belongs to an exact layer id. */
export class WallpaperLayers {
	private layers: WallpaperLayer[] = [];
	private latest: WallpaperSnapshot | undefined;
	private ready = new Set<number>();
	private failed = new Set<number>();
	private serial = "";
	private sequence = 0;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private hidden = false;
	private disposed = false;
	constructor(
		private readonly publish: (layers: readonly WallpaperLayer[]) => void,
		private readonly report: (
			snapshot: WallpaperSnapshot,
			index: number,
		) => void,
		private readonly reduced = () => false,
	) {}
	private emit() {
		this.publish([...this.layers]);
	}
	private clear() {
		clearTimeout(this.timer);
		this.timer = undefined;
		this.layers = [];
		this.ready.clear();
		this.failed.clear();
	}
	apply(snapshot: WallpaperSnapshot) {
		if (this.disposed) return;
		this.latest = snapshot;
		if (
			this.hidden ||
			snapshot.saved.settings.isTransparent ||
			snapshot.asset._tag !== "ready"
		) {
			this.clear();
			this.emit();
			return;
		}
		const key = JSON.stringify([
			snapshot.saved.serial,
			snapshot.saved.settings.displayMediaList.map((m) => [
				m.filePath,
				m.duration,
			]),
		]);
		if (key !== this.serial) {
			this.clear();
			this.serial = key;
		}
		const index = snapshot.activeIndex ?? 0;
		let active = this.layers.find((l) => l.state === "active");
		let wanted = this.layers.find(
			(l) => l.index === index && l.state !== "retired",
		);
		if (!wanted && snapshot.asset._tag === "ready") {
			wanted = {
				id: ++this.sequence,
				index,
				asset: snapshot.asset,
				snapshot,
				state: active ? "preload" : "active",
			};
			this.layers = active ? [active, wanted] : [wanted];
		}
		if (wanted && active?.id !== wanted.id) {
			if (this.failed.has(wanted.id)) {
				this.report(snapshot, index);
				return;
			}
			if (
				snapshot.saved.settings.displayMediaList[index]?.type !== "video" ||
				this.ready.has(wanted.id)
			) {
				clearTimeout(this.timer);
				const incoming = { ...wanted, snapshot, state: "active" as const };
				this.layers =
					active && !this.reduced()
						? [{ ...active, state: "retired" }, incoming]
						: [incoming];
				active = incoming;
				if (this.layers.length > 1)
					this.timer = setTimeout(() => {
						this.layers = this.layers.filter((l) => l.state !== "retired");
						this.emit();
					}, 800);
			}
		} else if (wanted)
			this.layers = this.layers.map((l) =>
				l.id === wanted.id ? { ...l, snapshot } : l,
			);
		const preload = snapshot.preload;
		if (
			preload?.asset._tag === "ready" &&
			active?.index === index &&
			!this.layers.some(
				(l) => l.index === preload.index && l.state === "preload",
			)
		) {
			this.layers = this.layers.filter((l) => l.state === "active");
			this.layers.push({
				id: ++this.sequence,
				index: preload.index,
				asset: preload.asset,
				snapshot,
				state: "preload",
			});
		}
		if (snapshot.asset._tag !== "ready" && !wanted) this.clear();
		this.emit();
	}
	loaded(id: number) {
		if (!this.layers.some((l) => l.id === id) || this.disposed) return;
		this.ready.add(id);
		if (this.latest) this.apply(this.latest);
	}
	error(id: number) {
		const layer = this.layers.find((l) => l.id === id);
		if (!layer || this.disposed) return;
		this.failed.add(id);
		if (this.latest && layer.index === (this.latest.activeIndex ?? 0))
			this.report(this.latest, layer.index);
	}
	visibility(hidden: boolean) {
		this.hidden = hidden;
		if (this.latest) this.apply(this.latest);
	}
	resize() {
		this.clear();
		if (this.latest) this.apply(this.latest);
	}
	dispose() {
		this.disposed = true;
		this.clear();
	}
}
