// ICNS contains image chunks; return a PNG representation without shelling out.
export function icnsPng(data: Buffer): Buffer | null {
  if (data.length < 8 || data.toString("ascii", 0, 4) !== "icns") return null;
  const limit = data.readUInt32BE(4);
  if (limit < 8 || limit > data.length || limit > 8 * 1024 * 1024) return null;
  for (let offset = 8; offset + 8 <= limit;) {
    const size = data.readUInt32BE(offset + 4);
    if (size < 8 || offset + size > limit) return null;
    const payload = data.subarray(offset + 8, offset + size);
    if (
      payload.length >= 8 &&
      payload
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      return payload;
    offset += size;
  }
  return null;
}
