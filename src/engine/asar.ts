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
