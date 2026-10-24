# GIF codec and caption helper

Task 3.1, `open-quake-lih.17.1.6`, implements the caption requirement in
`openspec/changes/management-center-parity/specs/emoji-keys/spec.md`, covering
CENTER-087 and CENTER-018. There are no runtime dependencies.

`shared/gif/index.ts` exports `decodeGif(bytes: Uint8Array): GifAnimation`,
`encodeGif(animation: GifAnimation): Uint8Array`, `GifError`, `GifErrorCode`,
`GifErrors` and `GIF_LIMITS`.

```ts
interface GifAnimation {
  readonly width: number;
  readonly height: number;
  readonly loopCount: number | null;
  readonly frames: readonly GifFrame[];
}
interface GifFrame {
  readonly rgba: Uint8ClampedArray;
  readonly delayMs: number;
}
```

Frames contain independently owned full canvases, in row-major RGBA order.
Delays retain the raw centisecond value converted to milliseconds, including
zero. `loopCount` retains the raw Netscape/ANIMEXTS repeat count: `null` means
no extension, `0` means infinite looping, and a positive value is the repeat
count. The encoder rejects delays outside 0–655350 ms or not divisible by 10.

Both directions enforce 8 MiB, 1024×1024, 300 frames and 128 MiB of retained
RGBA frame data. The decoder scans the complete file to enforce the frame
and total decoded byte limits before allocating pixel buffers. Working memory
adds at most a few canvases, one index buffer and fixed-size dictionaries.
The encoder also checks its output size while writing.

GIF87a/89a, global/local palettes, LZW clear/reset and 12-bit dictionaries,
transparent indices, image offsets, all interlace passes and disposal 0–3 are
supported. Compositing follows Chromium: uncovered pixels and disposal-2
rectangles become transparent. Comments and unknown extensions are skipped.
Plain-text rendering, user-input waits and undefined disposal modes are rejected.
Truncated data, invalid palette/dictionary indices, inconsistent pixel counts,
out-of-canvas rectangles and trailing bytes are rejected rather than repaired.

Each frame gets its own palette. Up to 255 opaque colours are exact; larger
palettes use a bounded histogram and weighted median cut. Index zero is reserved
for transparency. Alpha below 128 becomes transparent; alpha at least 128 becomes
opaque. GIF cannot retain partial alpha. There is no dithering or delta-frame
optimization, so a source near 8 MiB can exceed the output limit after rendering.

`renderer/src/management/emoji/caption.ts` exports:

```ts
captionGif(bytes: Uint8Array, settings: CaptionSettings): Promise<Uint8Array>
stillImageGif(sourceDataUrl: string): Promise<Uint8Array>
interface CaptionSettings {
  readonly text: string;
  readonly size?: number; // integer 12–100, default 48
  readonly color?: string; // 0xRRGGBBAA, default 0xffffffff
  readonly position?: "top" | "mid" | "bot"; // default bot
}
```

Always give `captionGif` the original GIF bytes. It decodes that source afresh,
copies every composited frame onto a fresh canvas, strokes dark text and fills
it with an 800-weight sans-serif font. It preserves dimensions, frame count,
delays and loop count. Empty text returns a validated byte copy of the original.
The helper never mutates its input or caches previous renders. Text is limited
to 50 weighted UTF-16 units, with U+4E00–U+9FA5 counting two. Newlines become spaces;
long lines fit the available width. Font rasterization depends on the host.

`stillImageGif` accepts base64 PNG/JPEG data URLs, validates bytes and header
dimensions before native decode, and makes one frame with delay zero and no
loop extension. Input is limited to 8 MiB and 1024×1024; it does not resize larger
static assets. Browser-decoded dimensions must match the header, so JPEGs whose
EXIF orientation swaps dimensions are rejected. Animated PNGs use their still
preview. Both helpers require browser canvas APIs for rendering.

Errors are `GifError` instances with stable codes `QUAKE.GIF.INVALID`,
`QUAKE.GIF.LIMIT`, `QUAKE.GIF.UNSUPPORTED`, `QUAKE.GIF.CAPTION_SETTINGS`,
`QUAKE.GIF.CANVAS_UNAVAILABLE` or `QUAKE.GIF.IMAGE_INVALID`. They contain only
canonical messages; a native cause is retained in non-enumerable `originalCause`.

## Verification

From `apps/desktop`, run `pnpm exec vitest run src/shared/gif`.
The tests include independent fixtures, all truncations of a known animation,
resource-limit preflight, real encoded-output overflow, exact and quantized
roundtrips, 100 seeded randomized animations and caption/image consumer tests.
`fixtures/pillow-lzw.gif` was generated independently with Pillow: 256×128 pixels,
palette entry n = [n,n,255-n], seed 0xdeadbeef, LCG step
`(state * 1664525 + 1013904223) mod 2^32`, high byte as the palette index.
Pillow is not needed to run the tests.

For native browser checks, run `pnpm exec vite --host 127.0.0.1 --port 5188
--strictPort` from `apps/desktop` and open
`http://127.0.0.1:5188/src/shared/gif/browser-smoke.html`. The page checks 19 frames
against Chromium's independent WebCodecs GIF decoder, including output from
this encoder. It also exercises real canvas caption edits, placement and PNG/JPEG
import. No desktop app, device connection or vendor process is started.
