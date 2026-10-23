import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { nativeImage } from "electron";
import {
	DESKTOP_RESOURCE_LIMIT,
	MediaUnreadable,
} from "../../renderer/src/wallpaper/display";

export interface DecodedImage {
	readonly format: "image/jpeg" | "image/png";
	readonly width: number;
	readonly height: number;
	readonly dataUrl: string;
}

export function normalizeLocalSelection(
	input: string,
): Effect.Effect<
	{ path: string; normalizedFileUrl: boolean },
	MediaUnreadable
> {
	return Effect.try({
		try: () => {
			const normalizedFileUrl = input.startsWith("file:");
			const path = normalizedFileUrl ? fileURLToPath(input) : input;
			if (!path || path.includes("\0")) throw new RangeError();
			return { path, normalizedFileUrl };
		},
		catch: (cause) => new MediaUnreadable(cause),
	});
}

export class ImageDecoder extends Effect.Service<ImageDecoder>()(
	"ImageDecoder",
	{
		accessors: true,
		sync: () => ({
			decode: Effect.fn("ImageDecoder.decode")(
				(bytes: Buffer): Effect.Effect<DecodedImage, MediaUnreadable> =>
					Effect.try({
						try: () => {
							const png = bytes
								.subarray(0, 8)
								.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
							const jpeg =
								bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
							if (
								bytes.length === 0 ||
								bytes.length > DESKTOP_RESOURCE_LIMIT ||
								(!png && !jpeg)
							)
								throw new RangeError();
							const image = nativeImage.createFromBuffer(bytes);
							const { width, height } = image.getSize();
							if (
								image.isEmpty() ||
								width <= 0 ||
								height <= 0 ||
								width * height > 64_000_000
							)
								throw new RangeError();
							return {
								format: png ? ("image/png" as const) : ("image/jpeg" as const),
								width,
								height,
								dataUrl: `data:${png ? "image/png" : "image/jpeg"};base64,${bytes.toString("base64")}`,
							};
						},
						catch: (cause) => new MediaUnreadable(cause),
					}),
			),
		}),
	},
) {}
