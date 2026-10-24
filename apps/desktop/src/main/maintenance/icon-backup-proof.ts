/** Synthetic native backup proof through the production store and image decoder. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { nativeImage } from "electron";
import {
	createInitialProfileEnvelope,
	encodeProfileEnvelope,
} from "../../../../../packages/device/src/profiles/profile-contracts";
import { iconStore } from "../key-library/icon-store";
import { prepareRestore } from "./backup-store";

export async function proveIconRestore(
	archive: Uint8Array,
	base: string,
	expectedData: string,
) {
	const results = [];
	for (const populated of [false, true]) {
		const root = join(base, populated ? "icons-populated" : "icons-clean");
		await mkdir(root);
		await writeFile(
			join(root, "profiles-v1.json"),
			JSON.stringify(encodeProfileEnvelope(createInitialProfileEnvelope())),
		);
		const path = join(root, "key-library-v1.json");
		if (populated)
			await Effect.runPromise(
				iconStore(path).write([
					{
						id: "destination",
						name: "Preserve",
						icons: [
							{ id: "keep", name: "Existing", tags: [], data: expectedData },
						],
					},
					{
						id: "local",
						name: "Local App Icons",
						icons: [
							{
								id: "existing-local",
								name: "Keep local",
								tags: [],
								data: expectedData,
							},
						],
					},
				]),
			);
		const restore = await prepareRestore(archive, "icons.zip");
		await restore.validate(root);
		await restore.commit(root);
		const packs = await Effect.runPromise(iconStore(path).read());
		for (const id of ["synthetic-pack", "local"]) {
			const pack = packs.find((pack) => pack.id === id);
			assert(pack);
			assert(
				pack?.icons.some(
					(icon) => icon.id === "backup-icon" && icon.data === expectedData,
				),
			);
			for (const icon of pack.icons)
				assert(!nativeImage.createFromDataURL(icon.data).isEmpty());
		}
		assert.equal(
			packs.some((pack) => pack.id === "destination"),
			populated,
		);
		if (populated)
			assert(
				packs
					.find((pack) => pack.id === "local")
					?.icons.some((icon) => icon.id === "existing-local"),
			);
		const before = await readFile(path, "utf8");
		await restore.validate(root);
		await restore.commit(root);
		assert.equal(await readFile(path, "utf8"), before);
		results.push({
			populated,
			packs: packs.map((pack) => ({
				id: pack.id,
				icons: pack.icons.map((icon) => icon.id),
			})),
			decoded: true,
			repeatedRestoreStable: true,
		});
	}
	return results;
}
