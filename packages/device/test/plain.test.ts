import { describe, expect, it } from "@effect/vitest";
import { FrameChecksumMismatch } from "@open-quake/protocol";
import { Effect } from "effect";
import { makeFakeHidTransport } from "../src/hid-fake.js";
import { createQuakeDevice } from "../src/plain.js";
import { report } from "./reports.js";

describe("plain JS facade", () => {
	it("delivers the kernel failure to the error callback after disconnect", async () => {
		const fake = await Effect.runPromise(makeFakeHidTransport());
		const client = createQuakeDevice({}, fake.layer);
		const seen: string[] = [];
		let onError: ((error: unknown) => void) | undefined;
		const failed = new Promise<unknown>((resolve) => {
			onError = resolve;
		});
		client.subscribe(
			(event) => seen.push(event._tag),
			(error) => onError?.(error),
		);
		try {
			await client.connect();
			const corrupt = report(3, 1, [1]);
			corrupt[5] = 0;
			await Effect.runPromise(fake.emit(corrupt));
			const error = await failed;
			expect(error).toBeInstanceOf(FrameChecksumMismatch);
			expect(error).toMatchObject({ code: "QUAKE.PROTOCOL.CHECKSUM_MISMATCH" });
			expect(seen).toEqual(["Disconnect"]);
			expect(await Effect.runPromise(fake.closes)).toBe(1);
		} finally {
			await client.disconnect();
		}
	});
	it("connects, receives callbacks, unsubscribes, and closes without Effect in the client flow", async () => {
		const fake = await Effect.runPromise(makeFakeHidTransport());
		const client = createQuakeDevice({}, fake.layer);
		const seen: string[] = [];
		let received: (() => void) | undefined;
		const next = new Promise<void>((resolve) => {
			received = resolve;
		});
		const unsubscribe = client.subscribe((event) => {
			seen.push(event._tag);
			received?.();
		});
		try {
			const [a, b] = await Promise.all([client.connect(), client.connect()]);
			expect(a.path).toBe("fake:quake");
			expect(b).toBe(a);
			expect(await Effect.runPromise(fake.opens)).toBe(1);
			await Effect.runPromise(fake.emit(report(3, 1, [1])));
			await next;
			expect(seen).toEqual(["KnobRotate"]);
			unsubscribe();
			await client.disconnect();
			expect(seen).toEqual(["KnobRotate"]);
			expect(await Effect.runPromise(fake.closes)).toBe(1);
			await expect(client.connect()).rejects.toMatchObject({
				_tag: "QuakeConnectionClosed",
			});
		} finally {
			await client.disconnect();
		}
	});
	it("delivers disconnect before disconnect() resolves and tolerates a throwing callback", async () => {
		const fake = await Effect.runPromise(makeFakeHidTransport());
		const client = createQuakeDevice({}, fake.layer);
		const seen: string[] = [];
		const failures: unknown[] = [];
		client.subscribe(
			() => {
				throw new Error("token=secret");
			},
			(error) => {
				failures.push(error);
			},
		);
		client.subscribe((event) => {
			seen.push(event._tag);
		});
		await client.connect();
		await client.disconnect();
		expect(seen).toEqual(["Disconnect"]);
		expect(failures).toMatchObject([
			{
				_tag: "QuakeCallbackFailed",
				code: "QUAKE.SUBSCRIPTION.CALLBACK_FAILED",
			},
		]);
		expect(JSON.stringify(failures)).not.toContain("token=secret");
	});
	it("surfaces typed missing-device failures as Promise rejections", async () => {
		const fake = await Effect.runPromise(makeFakeHidTransport([]));
		const client = createQuakeDevice({}, fake.layer);
		await expect(client.connect()).rejects.toMatchObject({
			_tag: "QuakeDeviceNotFound",
			code: "QUAKE.DEVICE.NOT_FOUND",
		});
		await expect(client.disconnect()).rejects.toMatchObject({
			_tag: "QuakeDeviceNotFound",
		});
		expect(await Effect.runPromise(fake.opens)).toBe(0);
	});
	it("disconnecting before connect never opens the transport", async () => {
		const fake = await Effect.runPromise(makeFakeHidTransport());
		const client = createQuakeDevice({}, fake.layer);
		await client.disconnect();
		expect(await Effect.runPromise(fake.opens)).toBe(0);
	});
});
