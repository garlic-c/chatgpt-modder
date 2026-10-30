import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readFile,
  writeFile,
  rm,
  readdir,
  rename,
  mkdir,
  symlink,
  readlink,
  lchmod,
  lstat,
} from "node:fs/promises";
import { join, normalize } from "node:path";
import { Asar, sha256 } from "../src/engine/asar";
import { treeHash } from "../src/engine/files";
import { quotaTarget, quotaModule, quotaFor } from "../src/modules/quota";
import { fixture, makeAsar } from "./helpers";
import { adapters } from "../src/modules/adapters";
import { Engine } from "../src/engine/engine";
import { extractFile } from "@electron/asar";
test("ASAR 修改、完整性与未修改资源保持", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.temp, { recursive: true, force: true }));
  const a = await Asar.load(f.asar),
    dest = join(f.temp, "next.asar");
  const hash = await a.rewrite(
    dest,
    new Map([[quotaTarget, Buffer.from("changed")]]),
  );
  const b = await Asar.load(dest);
  assert.equal(hash, b.headerHash);
  assert.equal(extractFile(dest, normalize(quotaTarget)).toString(), "changed");
  assert.equal((await b.read(quotaTarget)).toString(), "changed");
  assert.equal((await b.read("untouched.txt")).toString(), "保留的原始资源");
  assert.equal(b.entry(quotaTarget).integrity?.hash, sha256("changed"));
  assert.throws(() => a.entry("../bad"));
  await assert.rejects(() =>
    a.rewrite(join(f.temp, "bad.asar"), new Map([["no", Buffer.from("x")]])),
  );
});
test("安装、重复安装、停用、重新启用与原样恢复", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.temp, { recursive: true, force: true }));
  const original = await treeHash(f.root);
  assert.equal((await f.engine.inspect(f.root)).compatible, true);
  await f.engine.apply(f.root, ["quota"]);
  const first = await treeHash(f.root);
  assert.notEqual(first, original);
  assert.deepEqual((await f.engine.inspect(f.root)).modules, ["quota"]);
  await f.engine.apply(f.root, ["quota"]);
  assert.equal(await treeHash(f.root), first);
  await f.engine.apply(f.root, []);
  assert.equal(await treeHash(f.root), original);
  await f.engine.apply(f.root, ["quota"]);
  await f.engine.restore(f.root);
  assert.equal(await treeHash(f.root), original);
});
test("未知指纹禁止修改", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.temp, { recursive: true, force: true }));
  await makeAsar(f.asar, { [quotaTarget]: "unexpected" });
  await assert.rejects(() => f.engine.apply(f.root, ["quota"]), /尚未适配/);
});
test("文件内容被篡改但文件头未变也拒绝", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.temp, { recursive: true, force: true }));
  const bytes = await readFile(f.asar);
  bytes[bytes.length - 40] ^= 1;
  await writeFile(f.asar, bytes);
  await assert.rejects(() => f.engine.apply(f.root, ["quota"]));
});
test("运行中的客户端拒绝修改", async (t) => {
  const f = await fixture({
    assertStopped: async () => {
      throw Error("running");
    },
  });
  t.after(() => rm(f.temp, { recursive: true, force: true }));
  const hash = await treeHash(f.root);
  await assert.rejects(() => f.engine.apply(f.root, ["quota"]), /running/);
  assert.equal(await treeHash(f.root), hash);
});
test("签名失败保持目标完整并清理副本", async (t) => {
  const f = await fixture({
    signAndVerify: async () => {
      throw Error("sign failed");
    },
  });
  t.after(() => rm(f.temp, { recursive: true, force: true }));
  const hash = await treeHash(f.root);
  await assert.rejects(() => f.engine.apply(f.root, ["quota"]), /sign failed/);
  assert.equal(await treeHash(f.root), hash);
  assert.equal(
    (await readdir(f.temp)).some((n) => n.includes("stage")),
    false,
  );
});
test("备份损坏禁止恢复", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.temp, { recursive: true, force: true }));
  await f.engine.apply(f.root, ["quota"]);
  const dir = join(f.storage, sha256(f.root));
  await writeFile(join(dir, "original.app/Contents/Info.plist"), "corrupt");
  const hash = await treeHash(f.root);
  await assert.rejects(() => f.engine.restore(f.root), /备份损坏/);
  assert.equal(await treeHash(f.root), hash);
});
test("客户端升级后禁止旧版恢复与重新打补丁", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.temp, { recursive: true, force: true }));
  await f.engine.apply(f.root, ["quota"]);
  await writeFile(f.asar, "upgraded");
  await assert.rejects(() => f.engine.restore(f.root), /升级或发生变化/);
  await assert.rejects(() => f.engine.apply(f.root, ["quota"]));
});
test("替换期间中断可从事务记录回滚", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.temp, { recursive: true, force: true }));
  await f.engine.apply(f.root, ["quota"]);
  const dir = join(f.storage, sha256(f.root)),
    manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
  await writeFile(
    join(dir, "transaction.json"),
    JSON.stringify({
      schema: 1,
      root: f.root,
      phase: "swapping",
      previous: manifest,
      next: manifest,
    }),
  );
  await rename(f.root, join(f.temp, ".ChatGPT.app.cgm-previous.app"));
  assert.equal((await f.engine.inspect(f.root)).pending, true);
  await f.engine.recover(f.root);
  assert.equal(await treeHash(f.root), manifest.installedTree);
});
test("过期锁恢复与并发保护", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.temp, { recursive: true, force: true }));
  await f.engine.apply(f.root, ["quota"]);
  const lock = join(f.storage, sha256(f.root), "operation.lock");
  await writeFile(lock, String(process.pid));
  await assert.rejects(() => f.engine.apply(f.root, ["quota"]), /已有操作/);
  await assert.rejects(() => f.engine.recover(f.root), /仍在运行/);
  await writeFile(lock, "2147483647");
  await f.engine.recover(f.root);
  assert.equal((await f.engine.inspect(f.root)).compatible, true);
});

test("准备阶段中断可清理未完成副本且不改变客户端", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.temp, { recursive: true, force: true }));
  await f.engine.apply(f.root, ["quota"]);
  const dir = join(f.storage, sha256(f.root)),
    m = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")),
    stage = join(f.temp, ".ChatGPT.app.cgm-stage.app");
  await mkdir(stage);
  await writeFile(join(stage, "partial"), "partial");
  await writeFile(
    join(dir, "transaction.json"),
    JSON.stringify({
      schema: 1,
      root: f.root,
      phase: "preparing",
      previous: m,
      next: m,
    }),
  );
  const before = await treeHash(f.root);
  await f.engine.recover(f.root);
  assert.equal(await treeHash(f.root), before);
  assert.equal(
    (await readdir(f.temp)).some((n) => n.includes("stage")),
    false,
  );
});
test("相对符号链接安装与恢复保持不变", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.temp, { recursive: true, force: true }));
  await symlink("Resources", join(f.root, "Contents/Link"));
  const original = await treeHash(f.root);
  await f.engine.apply(f.root, ["quota"]);
  assert.equal(await readlink(join(f.root, "Contents/Link")), "Resources");
  await f.engine.restore(f.root);
  assert.equal(await treeHash(f.root), original);
});

test("旧预览版已安装的额度模块可直接升级并恢复原版", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.temp, { recursive: true, force: true }));
  const original = await treeHash(f.root),
    prepare = quotaModule.prepare,
    verify = quotaModule.verify;
  try {
    quotaModule.prepare = (files) => {
      const before = files.get(quotaTarget)!;
      return [
        {
          path: quotaTarget,
          before,
          after:
            before.replace(
              "function Ozn(e){",
              "function CGMOriginalProfile(e){",
            ) +
            "\n/* chatgpt-modder:quota@1 */ function Ozn(props){return CGMOriginalProfile(props)}",
        },
      ];
    };
    quotaModule.verify = (files) =>
      files.get(quotaTarget)?.includes("chatgpt-modder:quota@1") ?? false;
    await f.engine.apply(f.root, ["quota"]);
  } finally {
    quotaModule.prepare = prepare;
    quotaModule.verify = verify;
  }
  await f.engine.apply(f.root, ["quota"]);
  const archive = await Asar.load(f.asar),
    script = (await archive.read(quotaTarget)).toString();
  assert.match(script, /chatgpt-modder:quota@4/);
  assert.match(script, /Mzn\.Suspense/);
  assert.equal(script.includes("chatgpt-modder:quota@1"), false);
  await f.engine.restore(f.root);
  assert.equal(await treeHash(f.root), original);
});

test("引擎按适配器选择新版额度模块，拒绝缺少绑定证据的资源", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.temp, { recursive: true, force: true }));
  const binding = adapters.find(
    (a) => a.id === "win-26.1027.30824-x64",
  )!.quota!;
  // Synthetic host functions only; official code is never committed as a test fixture.
  const text =
    "function hwn(e){return e}/* " +
    binding.guards.filter((g) => g !== "function hwn(e){").join(" | ") +
    " */";
  await makeAsar(f.asar, { [binding.target]: text, "untouched.txt": "keep" });
  const adapter = f.services.adapters[0];
  adapter.quota = binding;
  adapter.files = { [binding.target]: sha256(text) };
  adapter.headerHash = (await Asar.load(f.asar)).headerHash;
  const original = await treeHash(f.root);
  await f.engine.apply(f.root, ["quota"]);
  const archive = await Asar.load(f.asar);
  const patched = (await archive.read(binding.target)).toString();
  assert.match(patched, /function hwn\(props\)/);
  assert.match(patched, /query=J\(Nb\)/);
  assert.match(patched, /scope=rf\(Z\)/);
  assert.equal((await archive.read("untouched.txt")).toString(), "keep");
  await f.engine.restore(f.root);
  assert.equal(await treeHash(f.root), original);
  const invalid = text.replace("Vhn as Nb,", "Vhn as Changed,");
  assert.throws(
    () => quotaFor(binding).prepare(new Map([[binding.target, invalid]])),
    /锚点/,
  );
});

test(
  "macOS 备份与恢复保留不同于 umask 的框架符号链接权限",
  { skip: process.platform !== "darwin" },
  async (t) => {
    const f = await fixture();
    t.after(() => rm(f.temp, { recursive: true, force: true }));
    const link = join(f.root, "Contents/FrameworkLink");
    await symlink("Resources", link);
    await lchmod(link, 0o755);
    const original = await treeHash(f.root);
    const previous = process.umask(0o077);
    try {
      await f.engine.apply(f.root, ["quota"]);
      assert.equal((await lstat(link)).mode & 0o777, 0o755);
      assert.equal(await readlink(link), "Resources");
      await f.engine.restore(f.root);
      assert.equal(await treeHash(f.root), original);
    } finally {
      process.umask(previous);
    }
  },
);

for (const restored of [false, true]) {
  test(`已知官方更新建立独立备份，保留${restored ? "已恢复" : "已安装"}的旧版记录`, async (t) => {
    const f = await fixture();
    t.after(() => rm(f.temp, { recursive: true, force: true }));
    const initial = (
      await (await Asar.load(f.asar)).read(quotaTarget)
    ).toString();
    await f.engine.apply(f.root, ["quota"]);
    if (restored) await f.engine.restore(f.root);
    const base = join(f.storage, sha256(f.root));
    const legacyManifest = await readFile(join(base, "manifest.json"), "utf8");
    const legacyBackup = await treeHash(join(base, "original.app"));
    const nextText = initial + "\n// next official version";
    await makeAsar(f.asar, {
      [quotaTarget]: nextText,
      "untouched.txt": "new original",
    });
    await writeFile(join(f.root, "Contents/Info.plist"), "new original plist");
    const oldInfo = f.engine.services.clientInfo;
    f.engine.services.clientInfo = async (root) => ({
      ...(await oldInfo(root)),
      version: "next",
    });
    f.engine.services.adapters.push({
      ...f.engine.services.adapters[0],
      id: "next",
      version: "next",
      headerHash: (await Asar.load(f.asar)).headerHash,
      files: { [quotaTarget]: sha256(nextText) },
    });
    const newOriginal = await treeHash(f.root);
    assert.equal((await f.engine.inspect(f.root)).compatible, true);
    assert.deepEqual((await f.engine.inspect(f.root)).modules, []);
    await assert.rejects(() => f.engine.restore(f.root));
    assert.equal(await treeHash(f.root), newOriginal);
    await f.engine.apply(f.root, ["quota"]);
    const active = JSON.parse(
      await readFile(join(base, "active.json"), "utf8"),
    );
    const currentDir = join(base, "generations", active.generation);
    assert.equal(
      JSON.parse(await readFile(join(currentDir, "manifest.json"), "utf8"))
        .version,
      "next",
    );
    assert.equal(
      await readFile(join(base, "manifest.json"), "utf8"),
      legacyManifest,
    );
    assert.equal(await treeHash(join(base, "original.app")), legacyBackup);
    const reopened = new Engine(f.storage, () => {}, f.engine.services);
    assert.deepEqual((await reopened.inspect(f.root)).modules, ["quota"]);
    await reopened.apply(f.root, ["quota"]);
    await reopened.restore(f.root);
    assert.equal(await treeHash(f.root), newOriginal);
    assert.equal(await treeHash(join(base, "original.app")), legacyBackup);
  });
}

test("未知更新不得切换备份代际", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.temp, { recursive: true, force: true }));
  await f.engine.apply(f.root, ["quota"]);
  const base = join(f.storage, sha256(f.root));
  const old = await readFile(join(base, "manifest.json"), "utf8");
  const info = f.engine.services.clientInfo;
  f.engine.services.clientInfo = async (root) => ({
    ...(await info(root)),
    version: "unknown",
  });
  await assert.rejects(() => f.engine.apply(f.root, ["quota"]));
  assert.equal(await readFile(join(base, "manifest.json"), "utf8"), old);
  await assert.rejects(() => readFile(join(base, "active.json")));
});

test("同版本非 ASAR 文件变化仍拒绝，不误判为官方更新", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.temp, { recursive: true, force: true }));
  await f.engine.apply(f.root, ["quota"]);
  await f.engine.restore(f.root);
  await writeFile(join(f.root, "Contents/foreign-change"), "external");
  await assert.rejects(
    () => f.engine.apply(f.root, ["quota"]),
    /客户端发生变化/,
  );
  await assert.rejects(() =>
    readFile(join(f.storage, sha256(f.root), "active.json")),
  );
});

test("新代际准备中断可恢复，旧代际和目录外文件不受影响", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.temp, { recursive: true, force: true }));
  await f.engine.apply(f.root, ["quota"]);
  await f.engine.restore(f.root);
  const base = join(f.storage, sha256(f.root)),
    old = await treeHash(join(base, "original.app"));
  const generation = "a".repeat(64),
    dir = join(base, "generations", generation);
  await mkdir(join(dir, "original.app"), { recursive: true });
  await writeFile(join(dir, "original.app/partial"), "unfinished");
  await writeFile(
    join(base, "active.json"),
    JSON.stringify({ schema: 1, generation }),
  );
  await f.engine.recover(f.root);
  await assert.rejects(() => readFile(join(dir, "original.app/partial")));
  assert.equal(await treeHash(join(base, "original.app")), old);
  await writeFile(
    join(base, "active.json"),
    JSON.stringify({ schema: 1, generation: "../../outside" }),
  );
  await assert.rejects(() => f.engine.inspect(f.root), /代际记录无效/);
});

test("版本变化时即使目录字节一致也不能恢复旧版", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.temp, { recursive: true, force: true }));
  await f.engine.apply(f.root, ["quota"]);
  const before = await treeHash(f.root),
    info = f.engine.services.clientInfo;
  f.engine.services.clientInfo = async (root) => ({
    ...(await info(root)),
    version: "different",
  });
  await assert.rejects(() => f.engine.restore(f.root), /版本已变化/);
  assert.equal(await treeHash(f.root), before);
});
