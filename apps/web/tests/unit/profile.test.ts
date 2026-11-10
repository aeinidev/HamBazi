import { describe, expect, it } from "vitest";
import { avatarPhoto, officialAvatars } from "../../src/ui/avatar.js";
import { cropRect, uploadError, loadUpload } from "../../src/features/profile/image.js";
import { imagePixelCount } from "../../src/features/profile/image-size.js";
import { readFileSync } from "node:fs";

describe("profile images", () => {
  it("reads PNG/JPEG/WebP/HEIF dimensions before any pixel decoder runs", async () => {
    const png = new Uint8Array(32);
    png.set([137, 80, 78, 71]);
    png.set([73, 72, 68, 82], 12);
    const view = new DataView(png.buffer);
    view.setUint32(16, 100000);
    view.setUint32(20, 100000);
    expect(imagePixelCount(png.buffer)).toBe(10000000000);
    await expect(loadUpload(new File([png], "large.png", { type: "image/png" }))).rejects.toThrow(
      "dimensions",
    );
    const jpeg = new Uint8Array(32);
    jpeg.set([255, 216, 255, 192, 0, 17, 8, 1, 144, 3, 32]);
    expect(imagePixelCount(jpeg.buffer)).toBe(800 * 400);
    for (const [path, size] of [
      ["../../src/assets/avatars/hb-01.webp", 512 * 512],
      ["../fixtures/rainbow.heic", 452 * 462],
    ] as const) {
      const data = new Uint8Array(readFileSync(new URL(path, import.meta.url)));
      expect(imagePixelCount(data.buffer)).toBe(size);
    }
    expect(() => imagePixelCount(new ArrayBuffer(3))).toThrow();
    expect(() => imagePixelCount(new ArrayBuffer(128))).toThrow();
  });
  it("contains exactly the ten supplied avatars in two freely selectable groups", () => {
    expect(officialAvatars).toHaveLength(10);
    expect(new Set(officialAvatars.map((item) => item.id)).size).toBe(10);
    for (const group of ["boys", "girls"])
      expect(officialAvatars.filter((item) => item.group === group)).toHaveLength(5);
    expect(avatarPhoto("hb-07", null)).toBe(officialAvatars[6]!.src);
    expect(avatarPhoto(null, "https://t.me/photo")).toBe("https://t.me/photo");
    expect(avatarPhoto("default", "https://t.me/photo")).toBeNull();
    expect(avatarPhoto("https://untrusted.example/photo", null)).toBeNull();
  });
  it("enforces the original upload limit and supported file types", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "image/heif", "image/heic"])
      expect(uploadError({ type, size: 3 * 1024 * 1024, name: "photo" })).toBeNull();
    expect(uploadError({ type: "", size: 200, name: "photo.HEIF" })).toBeNull();
    expect(uploadError({ type: "image/svg+xml", size: 200, name: "photo.png" })).not.toBeNull();
    expect(
      uploadError({ type: "image/png", size: 3 * 1024 * 1024 + 1, name: "photo.png" }),
    ).not.toBeNull();
    expect(uploadError({ type: "image/png", size: 0, name: "photo.png" })).not.toBeNull();
  });
  it("keeps a movable square crop inside portrait and landscape images", () => {
    expect(cropRect(800, 400, 1, 0, 0)).toEqual({ x: 200, y: 0, size: 400 });
    expect(cropRect(400, 800, 2, 100, -100)).toEqual({ x: 200, y: 0, size: 200 });
    for (const [width, height] of [
      [1200, 700],
      [400, 900],
    ])
      for (const zoom of [1, 1.5, 3])
        for (const x of [-100, 0, 100])
          for (const y of [-100, 0, 100]) {
            const crop = cropRect(width!, height!, zoom, x, y);
            expect(crop.x).toBeGreaterThanOrEqual(0);
            expect(crop.y).toBeGreaterThanOrEqual(0);
            expect(crop.x + crop.size).toBeLessThanOrEqual(width!);
            expect(crop.y + crop.size).toBeLessThanOrEqual(height!);
          }
  });
});
