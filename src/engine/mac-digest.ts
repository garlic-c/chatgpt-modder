import { createHash } from "node:crypto";
const sentinel = Buffer.from("AGbevlPCksUGKNL8TSn7wGmJEuJsXb2A");
export function rewriteMacDigest(
  binary: Buffer,
  integrity: Record<string, { algorithm: string; hash: string }>,
) {
  const hasher = createHash("sha256");
  for (const key of Object.keys(integrity).sort()) {
    const entry = integrity[key];
    if (entry.algorithm !== "SHA256" || !/^[a-f0-9]{64}$/.test(entry.hash))
      throw Error("未知的 macOS 完整性字典");
    hasher.update(key);
    hasher.update(entry.algorithm);
    hasher.update(entry.hash);
  }
  const digest = hasher.digest(),
    result = Buffer.from(binary);
  let offset = 0,
    count = 0;
  while ((offset = result.indexOf(sentinel, offset)) !== -1) {
    const slot = offset + sentinel.length;
    if (slot + 34 > result.length) throw Error("摘要槽不完整");
    const used = result[slot],
      version = result[slot + 1];
    if (!((used === 1 && version === 1) || (used === 0 && version === 0)))
      throw Error("未知的框架摘要版本");
    result[slot] = 1;
    result[slot + 1] = 1;
    digest.copy(result, slot + 2);
    count++;
    offset = slot + 34;
  }
  if (!count)
    throw Error("未找到已知的 Electron 框架摘要槽，拒绝关闭完整性校验");
  return result;
}
