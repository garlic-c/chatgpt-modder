import { version as modderVersion } from "../../package.json";
import { mkdir, cp, rename, rm, open, unlink, readFile } from "./native-fs";
import { randomUUID } from "node:crypto";
import { join, dirname, basename, resolve } from "node:path";
import { Asar, sha256 } from "./asar";
import { fileHash, treeHash, exists, atomicJson, readJson } from "./files";
import {
  clientInfo,
  assertStopped,
  updateIntegrity,
  signAndVerify,
  assertMutableInstallation,
} from "./platform";
import { adapters } from "../modules/adapters";
import { modulesForAdapter, resolveModules } from "../modules/quota";
import type { Adapter } from "../modules/types";

interface Manifest {
  schema: 1;
  root: string;
  version: string;
  adapterId: string;
  originalTree: string;
  installedTree: string | null;
  originalAsar: string;
  modules: string[];
}
interface Journal {
  schema: 1;
  root: string;
  phase: "preparing" | "staged" | "swapping" | "committed";
  previous: Manifest | null;
  next: Manifest;
}
export type Inspection = {
  root: string;
  version: string;
  compatible: boolean;
  status: string;
  modules: string[];
  message: string;
  pending: boolean;
  patchCompatible?: boolean;
};
export interface EngineServices {
  clientInfo: typeof clientInfo;
  assertStopped: typeof assertStopped;
  updateIntegrity: typeof updateIntegrity;
  signAndVerify: typeof signAndVerify;
  adapters: Adapter[];
}
export class Engine {
  readonly services: EngineServices;
  private generations = new Map<string, string>();
  constructor(
    readonly storage: string,
    readonly log: (s: string) => void = () => {},
    services: Partial<EngineServices> = {},
  ) {
    this.services = {
      clientInfo,
      assertStopped,
      updateIntegrity,
      signAndVerify,
      adapters,
      ...services,
    };
  }
  private paths(root: string) {
    const base = join(this.storage, sha256(resolve(root)));
    const dir = this.generations.has(root)
      ? join(base, "generations", this.generations.get(root)!)
      : base;
    return {
      base,
      active: join(base, "active.json"),
      dir,
      backup: join(dir, "original.app"),
      manifest: join(dir, "manifest.json"),
      journal: join(dir, "transaction.json"),
      lock: join(base, "operation.lock"),
      stage: join(dirname(root), "." + basename(root) + ".cgm-stage.app"),
      old: join(dirname(root), "." + basename(root) + ".cgm-previous.app"),
    };
  }
  private async loadGeneration(root: string) {
    const active = this.paths(root).active;
    if (!(await exists(active))) {
      this.generations.delete(root);
      return;
    }
    const state = await readJson<{ schema: number; generation: string }>(
      active,
    );
    if (state.schema !== 1 || !/^[a-f0-9]{64}$/.test(state.generation))
      throw Error("备份代际记录无效，已停止");
    this.generations.set(root, state.generation);
  }
  private async startGeneration(
    root: string,
    version: string,
    previousVersion: string,
  ) {
    const p = this.paths(root),
      generation = sha256(randomUUID());
    const next = join(p.base, "generations", generation);
    await mkdir(next, { recursive: true, mode: 0o700 });
    await atomicJson(p.active, {
      schema: 1,
      generation,
      version,
      previousVersion,
      previous: this.generations.get(root) ?? null,
    });
    this.generations.set(root, generation);
    this.log(
      `检测到客户端更新 ${previousVersion} → ${version}；旧版备份保留，为新版建立独立备份`,
    );
  }
  private async manifest(root: string) {
    const p = this.paths(root);
    if (!(await exists(p.manifest))) return null;
    const m = await readJson<Manifest>(p.manifest);
    if (m.schema !== 1 || m.root !== root) throw Error("备份记录不匹配");
    return m;
  }
  async diagnose(input: string) {
    const info = await this.services.clientInfo(input),
      archive = await Asar.load(info.asar);
    const files: Record<string, string> = {};
    const matching = this.services.adapters.filter(
      (a) => a.platform === info.platform && a.version === info.version,
    );
    const resources = matching.length
      ? matching
      : this.services.adapters.filter((a) => a.platform === info.platform);
    for (const path of new Set(
      resources.flatMap((a) => Object.keys(a.files)),
    )) {
      try {
        files[path] = sha256(await archive.read(path));
      } catch {
        files[path] = "missing";
      }
    }
    try {
      for (const name of Object.keys(
        archive.entry("webview/assets").files ?? {},
      ).filter((n) => /^app-(primary|initial)-.*\.js$/.test(n))) {
        const path = "webview/assets/" + name;
        files[path] = sha256(await archive.read(path));
      }
    } catch {}
    return {
      schema: 1,
      modderVersion,
      platform: info.platform,
      clientVersion: info.version,
      headerHash: archive.headerHash,
      declaredHeader: info.declaredHeader,
      files,
      knownAdapters: adapters
        .filter((a) => a.platform === info.platform)
        .map((a) => ({ id: a.id, version: a.version, status: a.status })),
      note: "仅含安装资源的版本和指纹，不包含账号、凭据或聊天内容",
    };
  }
  async inspect(input: string): Promise<Inspection> {
    // Recovery must also be available if a crash happened between the two renames.
    let root = resolve(input);
    if (await exists(root)) root = (await this.services.clientInfo(root)).root;
    await this.loadGeneration(root);
    const p = this.paths(root),
      pending = await exists(p.journal);
    if (!(await exists(root)) && pending)
      return {
        root,
        version: "恢复待完成",
        compatible: false,
        status: "recovery",
        modules: [],
        message: "检测到中断的操作，请恢复中断操作",
        pending,
      };
    const info = await this.services.clientInfo(root),
      archive = await Asar.load(info.asar),
      m = await this.manifest(root);
    if (info.declaredHeader && info.declaredHeader !== archive.headerHash)
      throw Error("客户端 ASAR 与声明的完整性哈希不一致");
    const upgraded = !!m && m.version !== info.version;
    const current = upgraded ? null : m;
    if (current?.installedTree) {
      if ((await fileHash(info.asar)) !== (await this.installedAsar(root)))
        return {
          root,
          version: info.version,
          compatible: false,
          status: "changed",
          modules: current.modules,
          message: "客户端已升级或被其他程序修改，禁止套用旧补丁或恢复旧版",
          pending,
        };
    }
    const adapter = this.services.adapters.find(
      (a) =>
        a.platform === info.platform &&
        a.version === info.version &&
        (a.headerHash === archive.headerHash ||
          (a.headerHash === null && info.platform === "win32" && !upgraded) ||
          (current?.adapterId === a.id && !!current.installedTree)),
    );
    if (adapter && !current?.installedTree) {
      await this.checkFiles(archive, adapter);
      await this.checkNative(root, adapter);
    }
    let restriction = "";
    try {
      await assertMutableInstallation(root);
    } catch (e) {
      restriction = (e as Error).message;
    }
    return {
      root,
      version: info.version,
      compatible: !!adapter && !restriction,
      patchCompatible: !!adapter,
      status: restriction ? "protected" : (adapter?.status ?? "unsupported"),
      modules: current?.modules ?? [],
      message:
        (restriction && !adapter
          ? `已定位商店客户端 ${info.version}，此版本尚未适配，修改已禁用；可导出兼容诊断。`
          : restriction) ||
        (adapter
          ? upgraded
            ? "检测到受支持的客户端更新；重新应用时为新版建立独立备份，保留旧版记录"
            : "已匹配客户端版本和文件指纹"
          : "此客户端版本或平台尚未适配，修改已禁用"),
      pending,
    };
  }
  private async installedAsar(root: string) {
    const p = this.paths(root);
    const state = await readJson<{ installedAsar: string }>(
      join(p.dir, "installed.json"),
    );
    return state.installedAsar;
  }
  private async checkFiles(archive: Asar, adapter: Adapter) {
    for (const [path, hash] of Object.entries(adapter.files))
      if (sha256(await archive.read(path)) !== hash)
        throw Error("客户端文件指纹不匹配：" + path);
  }
  private async checkNative(root: string, adapter: Adapter) {
    for (const [path, hash] of Object.entries(adapter.nativeFiles ?? {}))
      if ((await fileHash(join(root, path))) !== hash)
        throw Error("原生组件指纹不匹配：" + path);
  }
  private async withLock<T>(root: string, fn: () => Promise<T>) {
    const p = this.paths(root);
    await mkdir(p.base, { recursive: true, mode: 0o700 });
    let lock;
    try {
      lock = await open(p.lock, "wx", 0o600);
    } catch {
      throw Error(
        "已有操作或异常退出留下的锁；确认修改器均已关闭后，使用恢复中断操作",
      );
    }
    try {
      await lock.writeFile(String(process.pid));
      await this.loadGeneration(root);
      return await fn();
    } finally {
      await lock.close();
      await unlink(p.lock).catch(() => {});
    }
  }
  async apply(input: string, ids: string[]) {
    const selected = resolveModules(ids);
    if (!selected.length) return this.restore(input);
    const info = await this.services.clientInfo(input),
      root = info.root;
    return this.withLock(root, async () => {
      let p = this.paths(root);
      if (await exists(p.journal)) throw Error("先恢复中断操作");
      await assertMutableInstallation(root);
      const inspection = await this.inspect(root);
      if (!inspection.compatible) throw Error(inspection.message);
      await this.services.assertStopped(root);
      const currentTree = await treeHash(root);
      let oldManifest = await this.manifest(root);
      if ((await exists(p.stage)) || (await exists(p.old)))
        throw Error("暂存目录已存在，请先检查并恢复中断操作");
      const adapter = this.services.adapters.find(
        (a) => a.platform === info.platform && a.version === info.version,
      )!;
      if (oldManifest && oldManifest.version !== info.version) {
        // A new generation is allowed only for an exact pristine known build.
        // The old directory, backup and manifest remain untouched throughout.
        const pristine = await Asar.load(info.asar);
        if (!adapter.headerHash || adapter.headerHash !== pristine.headerHash)
          throw Error("新版客户端尚无完整原版指纹，已停止");
        await this.checkFiles(pristine, adapter);
        await this.checkNative(root, adapter);
        if ((await treeHash(root)) !== currentTree)
          throw Error("检查期间客户端发生变化，已停止");
        await this.startGeneration(root, info.version, oldManifest.version);
        p = this.paths(root);
        oldManifest = null;
      } else if (
        oldManifest &&
        currentTree !== (oldManifest.installedTree ?? oldManifest.originalTree)
      )
        throw Error("客户端发生变化，拒绝覆盖或旧版恢复");
      const selected = resolveModules(ids, modulesForAdapter(adapter));
      this.log("正在校验原版备份…");
      if (!oldManifest) {
        if (await exists(p.backup))
          throw Error("发现未完成的备份，请恢复中断操作后重试");
        await cp(root, p.backup, {
          recursive: true,
          preserveTimestamps: true,
          dereference: false,
          verbatimSymlinks: true,
        });
        const backupTree = await treeHash(p.backup);
        if (backupTree !== currentTree)
          throw Error("备份验证失败，未修改客户端");
        oldManifest = {
          schema: 1,
          root,
          version: info.version,
          adapterId: adapter.id,
          originalTree: currentTree,
          installedTree: null,
          originalAsar: await fileHash(info.asar),
          modules: [],
        };
        await atomicJson(p.manifest, oldManifest);
      }
      if ((await treeHash(p.backup)) !== oldManifest.originalTree)
        throw Error("原版备份损坏，已停止");
      this.log("正在副本上准备功能模块…");
      await atomicJson(p.journal, {
        schema: 1,
        root,
        phase: "preparing",
        previous: oldManifest,
        next: oldManifest,
      } satisfies Journal);
      try {
        await cp(p.backup, p.stage, {
          recursive: true,
          preserveTimestamps: true,
          dereference: false,
          verbatimSymlinks: true,
        });
        const resourcePath =
          info.platform === "darwin"
            ? "Contents/Resources/app.asar"
            : "resources/app.asar";
        const archive = await Asar.load(join(p.stage, resourcePath));
        await this.checkFiles(archive, adapter);
        const originals = new Map<string, string>();
        for (const module of selected)
          for (const path of module.targets)
            originals.set(path, (await archive.read(path)).toString());
        const edits = selected.flatMap((module) => module.prepare(originals));
        const changes = new Map(
          edits.map((e) => [e.path, Buffer.from(e.after)]),
        );
        const stagedAsar = join(p.stage, resourcePath),
          nextAsar = stagedAsar + ".next";
        const hash = await archive.rewrite(nextAsar, changes);
        await rename(nextAsar, stagedAsar);
        await this.services.updateIntegrity(p.stage, hash);
        this.log("正在更新本地签名并验证…");
        await this.services.signAndVerify(p.stage);
        const checked = await Asar.load(stagedAsar),
          files = new Map<string, string>();
        for (const module of selected)
          for (const path of module.targets)
            files.set(path, (await checked.read(path)).toString());
        for (const module of selected)
          if (!module.verify(files)) throw Error("模块验证失败：" + module.id);
        const next: Manifest = {
          ...oldManifest,
          installedTree: await treeHash(p.stage),
          modules: ids,
        };
        const installedAsar = await fileHash(stagedAsar);
        await this.services.assertStopped(root);
        if ((await treeHash(root)) !== currentTree)
          throw Error("准备期间客户端发生变化，已停止");
        await atomicJson(p.journal, {
          schema: 1,
          root,
          phase: "staged",
          previous: oldManifest,
          next,
        } satisfies Journal);
        await this.commit(root, next, installedAsar);
        this.log("修改完成。现在可启动 ChatGPT；修改器可以关闭。");
        return await this.inspect(root);
      } catch (error) {
        if (await exists(p.journal)) await this.recoverInternal(root);
        else await rm(p.stage, { recursive: true, force: true });
        throw error;
      }
    });
  }
  private async commit(
    root: string,
    next: Manifest,
    installedAsar: string | null,
  ) {
    const p = this.paths(root),
      j = await readJson<Journal>(p.journal);
    await atomicJson(p.journal, { ...j, phase: "swapping" });
    await rename(root, p.old);
    await rename(p.stage, root);
    await atomicJson(p.manifest, next);
    await atomicJson(join(p.dir, "installed.json"), { installedAsar });
    await atomicJson(p.journal, { ...j, phase: "committed" });
    await rm(p.old, { recursive: true, force: true });
    await unlink(p.journal);
  }
  async restore(input: string) {
    const info = await this.services.clientInfo(input),
      root = info.root;
    return this.withLock(root, async () => {
      const p = this.paths(root);
      if (await exists(p.journal)) throw Error("先恢复中断操作");
      await this.services.assertStopped(root);
      const m = await this.manifest(root);
      if (!m?.installedTree) throw Error("该客户端没有已安装的功能");
      if (m.version !== info.version)
        throw Error("客户端版本已变化，禁止恢复旧版");
      if ((await treeHash(root)) !== m.installedTree)
        throw Error("客户端已升级或发生变化，禁止恢复旧版");
      if ((await treeHash(p.backup)) !== m.originalTree)
        throw Error("原版备份损坏，已停止");
      if ((await exists(p.stage)) || (await exists(p.old)))
        throw Error("暂存目录已存在");
      const next = { ...m, installedTree: null, modules: [] };
      await atomicJson(p.journal, {
        schema: 1,
        root,
        phase: "preparing",
        previous: m,
        next,
      } satisfies Journal);
      try {
        await cp(p.backup, p.stage, {
          recursive: true,
          preserveTimestamps: true,
          dereference: false,
          verbatimSymlinks: true,
        });
        if ((await treeHash(p.stage)) !== m.originalTree)
          throw Error("恢复副本校验失败");
        await this.services.assertStopped(root);
        if ((await treeHash(root)) !== m.installedTree)
          throw Error("恢复期间客户端发生变化");
        await atomicJson(p.journal, {
          schema: 1,
          root,
          phase: "staged",
          previous: m,
          next,
        } satisfies Journal);
        await this.commit(root, next, null);
      } catch (e) {
        await this.recoverInternal(root);
        throw e;
      }
      this.log("已恢复原版及原始签名。");
      return await this.inspect(root);
    });
  }
  async recover(input: string) {
    const root = resolve(input);
    await this.loadGeneration(root);
    const p = this.paths(root);
    await mkdir(p.base, { recursive: true });
    if (await exists(p.lock)) {
      const pid = Number(await readFile(p.lock, "utf8"));
      if (!Number.isInteger(pid) || pid <= 0)
        throw Error("锁记录无效，请人工检查");
      try {
        process.kill(pid, 0);
        throw Error("该操作仍在运行，不能恢复");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e;
      }
      await unlink(p.lock);
    }
    return this.withLock(root, () => this.recoverInternal(root));
  }
  private async recoverInternal(root: string) {
    const p = this.paths(root);
    await this.services.assertStopped(root);
    if (!(await exists(p.journal))) {
      if ((await exists(p.stage)) || (await exists(p.old)))
        throw Error("缺少事务记录，不能自动处理暂存文件");
      if (!(await exists(p.manifest)) && (await exists(p.backup))) {
        await rm(p.backup, { recursive: true });
      }
      return;
    }
    const j = await readJson<Journal>(p.journal);
    if (j.schema !== 1 || j.root !== root) throw Error("事务记录不匹配");
    if (j.phase === "committed") {
      if (
        !(await exists(root)) ||
        (await treeHash(root)) !== (j.next.installedTree ?? j.next.originalTree)
      )
        throw Error("已提交的客户端发生变化，停止恢复");
      await rm(p.old, { recursive: true, force: true });
    } else if (await exists(p.old)) {
      if (
        (await treeHash(p.old)) !==
        (j.previous?.installedTree ?? j.previous?.originalTree)
      )
        throw Error("回滚副本损坏，停止恢复");
      if (await exists(root)) {
        if (
          (await treeHash(root)) !==
          (j.next.installedTree ?? j.next.originalTree)
        )
          throw Error("目标发生变化，停止回滚");
        await rm(root, { recursive: true });
      }
      await rename(p.old, root);
      if (j.previous) await atomicJson(p.manifest, j.previous);
      const a = await this.services.clientInfo(root);
      await atomicJson(join(p.dir, "installed.json"), {
        installedAsar: j.previous?.installedTree
          ? await fileHash(a.asar)
          : null,
      });
    }
    await rm(p.stage, { recursive: true, force: true });
    await unlink(p.journal);
    this.log("中断操作已恢复。");
  }
}
