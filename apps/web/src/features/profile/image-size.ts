// Read container headers before a decoder allocates a full-resolution pixel buffer.
export function imagePixelCount(buffer: ArrayBuffer): number {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const tag = (offset: number) => String.fromCharCode(...bytes.slice(offset, offset + 4));
  const pixels = (width: number, height: number) => {
    if (!width || !height) throw new Error("Invalid image dimensions");
    return width * height;
  };
  if (bytes.length < 24) throw new Error("Invalid image header");
  if (tag(0) === "\x89PNG" && tag(12) === "IHDR")
    return pixels(view.getUint32(16), view.getUint32(20));
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++]!;
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker,
        ) &&
        length >= 7
      )
        return pixels(view.getUint16(offset + 5), view.getUint16(offset + 3));
      offset += length;
    }
  }
  if (tag(0) === "RIFF" && tag(8) === "WEBP") {
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const type = tag(offset);
      const size = view.getUint32(offset + 4, true);
      const start = offset + 8;
      if (start + size > bytes.length) break;
      if (type === "VP8X" && size >= 10) {
        const u24 = (at: number) => bytes[at]! + bytes[at + 1]! * 256 + bytes[at + 2]! * 65536;
        return pixels(u24(start + 4) + 1, u24(start + 7) + 1);
      }
      if (type === "VP8L" && size >= 5 && bytes[start] === 0x2f) {
        const packed = view.getUint32(start + 1, true);
        return pixels((packed & 0x3fff) + 1, ((packed >>> 14) & 0x3fff) + 1);
      }
      if (
        type === "VP8 " &&
        size >= 10 &&
        bytes[start + 3] === 0x9d &&
        bytes[start + 4] === 0x01 &&
        bytes[start + 5] === 0x2a
      )
        return pixels(
          view.getUint16(start + 6, true) & 0x3fff,
          view.getUint16(start + 8, true) & 0x3fff,
        );
      offset = start + size + (size % 2);
    }
  }
  if (tag(4) === "ftyp") {
    let maximum = 0;
    function boxes(start: number, end: number, depth: number) {
      if (depth > 6) throw new Error("Invalid image container");
      for (let at = start; at + 8 <= end;) {
        let size = view.getUint32(at);
        let header = 8;
        const type = tag(at + 4);
        if (size === 1) {
          size = Number(view.getBigUint64(at + 8));
          header = 16;
        }
        if (size === 0) size = end - at;
        if (size < header || at + size > end) throw new Error("Invalid image container");
        if (type === "ispe" && size >= header + 12)
          maximum = Math.max(
            maximum,
            pixels(view.getUint32(at + header + 4), view.getUint32(at + header + 8)),
          );
        if (["meta", "iprp", "ipco"].includes(type))
          boxes(at + header + (type === "meta" ? 4 : 0), at + size, depth + 1);
        at += size;
      }
    }
    boxes(0, bytes.length, 0);
    if (maximum) return maximum;
  }
  throw new Error("Unsupported image dimensions");
}
