import { BackupFailed } from "../../../../../packages/edge/src/maintenance/maintenance-errors.js";
import { backupLimits } from "./backup-archive";

/** Raw work is cumulative, even when normalization shrinks or content deduplication replaces an entry. */
export class BackupReadBudget {
	private bytes = 0;
	private entries = 0;
	check(size: number): void {
		if (
			!Number.isSafeInteger(size) ||
			size < 0 ||
			size > backupLimits.entry ||
			this.bytes + size > backupLimits.total ||
			this.entries >= backupLimits.entries
		)
			throw new BackupFailed();
	}
	reserve(size: number): void {
		this.check(size);
		this.bytes += size;
		this.entries++;
	}
}

/** Charges retained archive paths, including replacements and generated projections, before insertion. */
export class BackupFiles extends Map<string, Uint8Array> {
	private bytes: number;
	constructor() {
		super();
		this.bytes = 0;
	}
	check(path: string, size: number): void {
		const total = this.bytes - (this.get(path)?.length ?? 0) + size;
		if (
			size > backupLimits.entry ||
			total > backupLimits.total ||
			(!this.has(path) && this.size >= backupLimits.entries)
		)
			throw new BackupFailed();
	}
	override set(path: string, content: Uint8Array): this {
		this.check(path, content.length);
		this.bytes += content.length - (this.get(path)?.length ?? 0);
		return super.set(path, content);
	}
	override delete(path: string): boolean {
		this.bytes -= this.get(path)?.length ?? 0;
		return super.delete(path);
	}
	override clear(): void {
		this.bytes = 0;
		super.clear();
	}
}
