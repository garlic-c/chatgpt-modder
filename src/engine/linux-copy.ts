import { cp, mkdir, rename, rm, lstat, readdir, chmod } from "./native-fs";
import { join, resolve } from "node:path";
import { atomicJson, exists, fileHash, readJson, treeHash } from "./files";
import { sha256 } from "./asar";

// The official .deb installs into root-owned system directories. Those files
// are never changed. Each original installation fingerprint gets its own
// independent, transactional user-local copy, mirroring the Windows Store
// strategy; the copy keeps the source permission bits (including executable
// bits) and only gains owner write access so the engine can patch it.
export class LinuxCopy {
  constructor(readonly storage: string) {}
  private async paths(source: string) {
    const original = resolve(source);
    const sourceHash = await fileHash(join(original, "resources/app.asar"));
    const dir = join(this.storage, sha256(original + "\0" + sourceHash));
    return {
      original,
      sourceHash,
      dir,
      root: join(dir, "client"),
      stage: join(dir, "preparing"),
      record: join(dir, "origin.json"),
    };
  }
  async existing(source: string) {
    const p = await this.paths(source);
    if (!(await exists(p.root))) return null;
    const record = await readJson<{ original: string; sourceHash: string }>(
      p.record,
    );
    if (record.original !== p.original || record.sourceHash !== p.sourceHash)
      throw Error("本地副本来源记录不匹配，请导出兼容诊断");
    return p.root;
  }
  async prepare(
    source: string,
    validate: (root: string) => Promise<void>,
    log: (s: string) => void,
  ) {
    const p = await this.paths(source);
    const existing = await this.existing(source);
    if (existing) return existing;
    await mkdir(p.dir, { recursive: true });
    // This is only our staging directory, never a client or a backup directory.
    await rm(p.stage, { recursive: true, force: true });
    log("正在创建用户目录副本，官方系统安装保持不变…");
    const before = await treeHash(p.original);
    try {
      await cp(p.original, p.stage, {
        recursive: true,
        dereference: false,
        filter: async (path) => {
          if ((await lstat(path)).isSymbolicLink())
            throw Error("系统安装包含符号链接，不能安全创建副本");
          return true;
        },
      });
      if (
        (await treeHash(p.stage)) !== before ||
        (await treeHash(p.original)) !== before
      )
        throw Error(
          "复制期间官方客户端发生变化，已取消；请等待系统更新完成后重试",
        );
      const writable = async (path: string): Promise<void> => {
        const stat = await lstat(path);
        await chmod(
          path,
          stat.isDirectory() ? 0o755 : (stat.mode & 0o777) | 0o200,
        );
        if (stat.isDirectory())
          for (const name of await readdir(path))
            await writable(join(path, name));
      };
      await writable(p.stage);
      await validate(p.stage);
      await atomicJson(p.record, {
        schema: 1,
        original: p.original,
        sourceHash: p.sourceHash,
      });
      await rename(p.stage, p.root);
      log("本地副本已就绪，开始应用修改");
      return p.root;
    } catch (e) {
      await rm(p.stage, { recursive: true, force: true });
      throw e;
    }
  }
}
