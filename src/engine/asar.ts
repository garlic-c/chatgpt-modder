import { open, rename, unlink } from "./native-fs";
import { createHash } from "node:crypto";

export type Entry = {
  files?: Record<string, Entry>;
  offset?: string;
  size?: number;
  unpacked?: boolean;
  link?: string;
  integrity?: {
    algorithm: string;
    hash: string;
    blockSize: number;
    blocks: string[];
  };
};
export const sha256 = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");
export class Asar {
  constructor(
    readonly path: string,
    readonly header: Entry,
    readonly dataOffset: number,
    readonly headerHash: string,
  ) {}
  static async load(path: string) {
    const f = await open(path, "r");
    try {
      const prefix = Buffer.alloc(16);
      await f.read(prefix, 0, 16, 0);
      const size = prefix.readUInt32LE(12),
        headerSize = prefix.readUInt32LE(4);
      if (
        prefix.readUInt32LE(0) !== 4 ||
        size > 64 * 1024 * 1024 ||
        size < 2 ||
        headerSize < size + 8
      )
        throw Error("无效的 ASAR 文件头");
      const json = Buffer.alloc(size);
      const read = await f.read(json, 0, size, 16);
      if (read.bytesRead !== size) throw Error("ASAR 文件头不完整");
      return new Asar(
        path,
        JSON.parse(json.toString()),
        8 + headerSize,
        sha256(json),
      );
    } finally {
      await f.close();
    }
  }
  entry(path: string): Entry {
    let e = this.header;
    for (const part of path.split("/")) {
      if (!part || part === "." || part === "..") throw Error("无效的归档路径");
      e = e.files?.[part] as Entry;
      if (!e) throw Error(`归档内缺少 ${path}`);
    }
    return e;
  }
  async read(path: string) {
    const e = this.entry(path);
    if (
      e.unpacked ||
      e.link ||
      e.offset == null ||
      e.size == null ||
      e.size > 64 * 1024 * 1024
    )
      throw Error(`不能读取 ${path}`);
    const f = await open(this.path, "r");
    try {
      const b = Buffer.alloc(e.size);
      const r = await f.read(
        b,
        0,
        b.length,
        this.dataOffset + Number(e.offset),
      );
      if (r.bytesRead !== b.length) throw Error("归档数据不完整");
      return b;
    } finally {
      await f.close();
    }
  }
  // Compare with a known release while excluding only its package version.
  // This calculation is read-only. Preserve every other header field.
  async headerAtPackageVersion(version: string): Promise<string | null> {
    const entry = this.header.files?.["package.json"];
    if (!entry?.integrity || entry.integrity.algorithm !== "SHA256" ||
        !entry.size || entry.size > 1024 * 1024 || entry.offset == null ||
        entry.unpacked || entry.link) return null;
    const bytes = await this.read("package.json");
    if (sha256(bytes) !== entry.integrity.hash) return null;
    const text = bytes.toString("utf8");
    const pkg = JSON.parse(text);
    if (typeof pkg.version !== "string" || pkg.version === version) return null;
    const field = /("version"\s*:\s*)"(?:[^"\\]|\\.)*"/g;
    for (const match of text.matchAll(field)) {
      const start = match.index!;
      const revised = text.slice(0, start) + match[1] + JSON.stringify(version) +
        text.slice(start + match[0].length);
      if (JSON.parse(revised).version !== version) continue;
      const value = Buffer.from(revised);
      const { blockSize } = entry.integrity;
      if (!Number.isSafeInteger(blockSize) || blockSize <= 0) return null;
      if (entry.integrity.blocks.length !== Math.ceil(bytes.length / blockSize)) return null;
      for (let i = 0; i < bytes.length; i += blockSize)
        if (entry.integrity.blocks[i / blockSize] !== sha256(bytes.subarray(i, i + blockSize))) return null;
      const blocks: string[] = [];
      for (let i = 0; i < value.length; i += blockSize)
        blocks.push(sha256(value.subarray(i, i + blockSize)));
      const header = structuredClone(this.header);
      const next = header.files!["package.json"];
      next.size = value.length;
      next.integrity!.hash = sha256(value);
      next.integrity!.blocks = blocks;
      const delta = value.length - bytes.length;
      const end = Number(entry.offset) + bytes.length;
      function shift(node: Entry) {
        if (node.files) Object.values(node.files).forEach(shift);
        else if (node.offset != null && Number(node.offset) >= end)
          node.offset = String(Number(node.offset) + delta);
      }
      if (delta) shift(header);
      return sha256(JSON.stringify(header));
    }
    return null;
  }
  async rewrite(destination: string, changes: Map<string, Buffer>) {
    const header: Entry = structuredClone(this.header);
    const entries: { path: string; old: Entry; next: Entry }[] = [];
    const visit = (e: Entry, n: Entry, prefix = "") => {
      for (const [name, child] of Object.entries(e.files ?? {})) {
        const path = prefix ? `${prefix}/${name}` : name,
          next = n.files![name];
        if (child.files) visit(child, next, path);
        else if (!child.unpacked && !child.link && child.offset != null)
          entries.push({ path, old: child, next });
      }
    };
    visit(this.header, header);
    for (const key of changes.keys())
      if (!entries.some((e) => e.path === key))
        throw Error(`补丁目标不存在：${key}`);
    entries.sort((a, b) => Number(a.old.offset) - Number(b.old.offset));
    let offset = 0;
    for (const e of entries) {
      const data = changes.get(e.path);
      e.next.offset = String(offset);
      if (data) {
        e.next.size = data.length;
        const blockSize = e.old.integrity?.blockSize ?? 4194304;
        const blocks: string[] = [];
        for (let i = 0; i < data.length; i += blockSize)
          blocks.push(sha256(data.subarray(i, i + blockSize)));
        e.next.integrity = {
          algorithm: "SHA256",
          hash: sha256(data),
          blockSize,
          blocks,
        };
      }
      offset += e.next.size!;
    }
    const json = Buffer.from(JSON.stringify(header));
    const payloadSize = 4 + json.length,
      padded = (payloadSize + 3) & ~3;
    const prefix = Buffer.alloc(8 + 4 + padded);
    prefix.writeUInt32LE(4, 0);
    prefix.writeUInt32LE(4 + padded, 4);
    prefix.writeUInt32LE(padded, 8);
    prefix.writeUInt32LE(json.length, 12);
    json.copy(prefix, 16);
    const source = await open(this.path, "r"),
      target = await open(destination, "wx");
    try {
      await target.writeFile(prefix);
      const buffer = Buffer.alloc(4 * 1024 * 1024);
      for (const e of entries) {
        const data = changes.get(e.path);
        if (data) {
          await target.writeFile(data);
          continue;
        }
        let left = e.old.size!,
          position = this.dataOffset + Number(e.old.offset);
        while (left > 0) {
          const r = await source.read(
            buffer,
            0,
            Math.min(left, buffer.length),
            position,
          );
          if (!r.bytesRead) throw Error("归档数据提前结束");
          await target.writeFile(buffer.subarray(0, r.bytesRead));
          left -= r.bytesRead;
          position += r.bytesRead;
        }
      }
      await target.sync();
    } catch (error) {
      await target.close();
      await source.close();
      await unlink(destination).catch(() => {});
      throw error;
    }
    await target.close();
    await source.close();
    return sha256(json);
  }
}
