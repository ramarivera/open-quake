/** DOM emulators don't run layout; tests deliver the browser's resize notification. */
export class TestResizeObserver implements ResizeObserver {
	static instances: TestResizeObserver[] = [];
	readonly targets = new Set<Element>();
	constructor(private readonly callback: ResizeObserverCallback) {
		TestResizeObserver.instances.push(this);
	}
	observe(target: Element): void {
		this.targets.add(target);
	}
	unobserve(target: Element): void {
		this.targets.delete(target);
	}
	disconnect(): void {
		this.targets.clear();
	}
	resize(): void {
		this.callback([], this);
	}
}
