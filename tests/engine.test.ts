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
} from "node:fs/promises";
import { join } from "node:path";
import { Asar, sha256 } from "../src/engine/asar";
import { treeHash } from "../src/engine/files";
import { quotaTarget, quotaModule } from "../src/modules/quota";
import { fixture, makeAsar } from "./helpers";
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
  assert.equal(extractFile(dest, quotaTarget).toString(), "changed");
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
