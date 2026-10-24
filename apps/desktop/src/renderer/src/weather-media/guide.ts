/** Recovered no-session toast timings: KNOB-099, WIDGETS-118. */
export class MediaGuide {
	private hideTimer: ReturnType<typeof setTimeout> | undefined;
	private lossTimer: ReturnType<typeof setTimeout> | undefined;
	private hadSession = false;
	private shown = false;
	private lastShown = -Infinity;
	private lastSession = -Infinity;
	constructor(private readonly publish: (visible: boolean) => void) {}
	update(hasSession: boolean, available = true): void {
		clearTimeout(this.lossTimer);
		if (hasSession || !available) {
			if (hasSession) this.lastSession = Date.now();
			this.hadSession = hasSession;
			this.shown = false;
			clearTimeout(this.hideTimer);
			this.publish(false);
			return;
		}
		if (this.hadSession) {
			this.hadSession = false;
			this.lossTimer = setTimeout(() => {
				this.shown = false;
				this.show();
			}, 3000);
		} else this.show();
	}
	show(force = false): void {
		if (
			Date.now() - this.lastSession < 1500 ||
			Date.now() - this.lastShown < 1500 ||
			(this.shown && !force)
		)
			return;
		this.shown = true;
		this.lastShown = Date.now();
		this.publish(true);
		clearTimeout(this.hideTimer);
		this.hideTimer = setTimeout(() => this.publish(false), 4500);
	}
	dispose(): void {
		clearTimeout(this.hideTimer);
		clearTimeout(this.lossTimer);
	}
}
