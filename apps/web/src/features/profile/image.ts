import { imagePixelCount } from "./image-size.js";
export const maxUploadBytes = 3 * 1024 * 1024;
export function uploadError(file: Pick<File, "type" | "size" | "name">) {
  if (!file.size || file.size > maxUploadBytes) return "حجم عکس باید حداکثر ۳ مگابایت باشد.";
  if (
    ![
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heif",
      "image/heic",
      "image/heif-sequence",
      "image/heic-sequence",
    ].includes(file.type) &&
    !(file.type === "" && /\.(jpe?g|png|webp|heif|heic)$/i.test(file.name))
  )
    return "فرمت عکس باید JPEG، PNG، WebP یا HEIF باشد.";
  return null;
}

export function cropRect(width: number, height: number, zoom: number, x: number, y: number) {
  const size = Math.min(width, height) / Math.max(1, zoom);
  return { x: ((width - size) * (x + 100)) / 200, y: ((height - size) * (y + 100)) / 200, size };
}

export type CropView = { zoom: number; x: number; y: number };
export type CropPoint = { x: number; y: number };

/** Points are relative to the displayed circle, so preview and export share image coordinates. */
export function cropGesture(
  width: number,
  height: number,
  view: CropView,
  from: readonly CropPoint[],
  to: readonly CropPoint[],
): CropView {
  if (!from.length || from.length !== to.length) return view;
  const centre = (points: readonly CropPoint[]) => ({
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  });
  const distance = (points: readonly CropPoint[]) =>
    Math.hypot(points[1]!.x - points[0]!.x, points[1]!.y - points[0]!.y);
  const ratio = from.length === 2 && distance(from) > 0.001 ? distance(to) / distance(from) : 1;
  const zoom = Math.max(1, Math.min(3, view.zoom * ratio));
  const before = cropRect(width, height, view.zoom, view.x, view.y);
  const size = Math.min(width, height) / zoom;
  const start = centre(from),
    end = centre(to);
  const position = (anchor: number, point: number, extent: number) =>
    extent <= 0 ? 0 : Math.max(-100, Math.min(100, ((anchor - point * size) / extent) * 200 - 100));
  return {
    zoom,
    x: position(before.x + start.x * before.size, end.x, width - size),
    y: position(before.y + start.y * before.size, end.y, height - size),
  };
}

export async function loadUpload(file: File): Promise<HTMLImageElement> {
  const error = uploadError(file);
  if (error) throw new Error(error);
  if (imagePixelCount(await file.arrayBuffer()) > 40000000)
    throw new Error("Image dimensions exceed the supported limit");
  let blob: Blob = file;
  if (/heif|heic/i.test(file.type) || /\.(heif|heic)$/i.test(file.name)) {
    const { heicTo } = await import("heic-to/csp");
    blob = await heicTo({ blob: file, type: "image/jpeg", quality: 0.92 });
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (
      !image.naturalWidth ||
      !image.naturalHeight ||
      image.naturalWidth * image.naturalHeight > 40000000
    )
      throw new Error("Image dimensions exceed the supported limit");
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}
