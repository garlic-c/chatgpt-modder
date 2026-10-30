import { NtExecutable, NtExecutableResource } from "resedit";
const same = (a: string | number, b: string) =>
  String(a).toLowerCase() === b.toLowerCase();
export function peHeaderHash(binary: Buffer) {
  const exe = NtExecutable.from(binary, { ignoreCert: true }),
    resources = NtExecutableResource.from(exe);
  const entry = resources.entries.find(
    (e) => same(e.type, "Integrity") && same(e.id, "ElectronAsar"),
  );
  if (!entry) throw Error("Windows 客户端缺少已知的 Electron ASAR 完整性资源");
  const entries = JSON.parse(
    Buffer.from(entry.bin).toString("utf8").replace(/\0+$/, ""),
  );
  const item = entries.find(
    (e: { file?: string }) =>
      e.file?.replaceAll("\\", "/").toLowerCase() === "resources/app.asar",
  );
  if (!item || item.alg !== "sha256" || !/^[a-f0-9]{64}$/i.test(item.value))
    throw Error("Windows 完整性资源格式不匹配");
  return item.value as string;
}
export function rewritePeHeaderHash(binary: Buffer, hash: string) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw Error("无效的 ASAR 哈希");
  const before = peHeaderHash(binary),
    exe = NtExecutable.from(binary, { ignoreCert: true }),
    resources = NtExecutableResource.from(exe);
  const entry = resources.entries.find(
    (e) => same(e.type, "Integrity") && same(e.id, "ElectronAsar"),
  )!;
  const values = JSON.parse(
    Buffer.from(entry.bin).toString("utf8").replace(/\0+$/, ""),
  );
  for (const value of values)
    if (
      value.file?.replaceAll("\\", "/").toLowerCase() === "resources/app.asar"
    )
      value.value = hash;
  resources.replaceResourceEntryFromString(
    entry.type,
    entry.id,
    entry.lang,
    JSON.stringify(values),
  );
  resources.outputResource(exe);
  const result = Buffer.from(exe.generate());
  if (peHeaderHash(result) !== hash)
    throw Error("Windows 完整性资源写入验证失败");
  return result;
}
