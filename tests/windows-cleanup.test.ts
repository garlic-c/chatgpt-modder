import assert from "node:assert/strict";
import { test } from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { Engine } from "../src/engine/engine";
import { WindowsCopy } from "../src/engine/windows-copy";
import { sha256 } from "../src/engine/asar";
import { exists, treeHash } from "../src/engine/files";

async function fixture() {
  const dir = await realpath(
    await mkdtemp(join(tmpdir(), "cgm-cleanup-test-")),
  );
  const original = join(dir, "official");
  const content = "fixture";
  const sourceHash = sha256(content);
  const clients = join(dir, "clients");
  const copyDir = join(clients, sha256(original + "\0" + sourceHash));
  const root = join(copyDir, "client");
  const storage = join(dir, "backups");
  const base = join(storage, sha256(root));
  const backup = join(base, "original.app");
  const active = join(base, "active.json");
  await mkdir(join(root, "resources"), { recursive: true });
  await writeFile(join(root, "resources/app.asar"), content);
  await writeFile(
    join(copyDir, "origin.json"),
    JSON.stringify({ schema: 1, original, sourceHash }),
  );
  await mkdir(base, { recursive: true });
  await cp(root, backup, { recursive: true });
  await writeFile(
    join(base, "manifest.json"),
    JSON.stringify({
      root,
      schema: 1,
      version: "1",
      modules: [],
      installedTree: null,
      originalTree: await treeHash(root),
      originalAsar: sourceHash,
    }),
  );
  const engine = new Engine(storage, undefined, {
    assertStopped: async () => {},
  });
  const offer = engine.offerRestoredCopyCleanup.bind(
    engine,
    new WindowsCopy(clients),
    root,
  );
  return { dir, root, backup, active, base, offer };
}
test("保留文件和关闭弹窗不触发回收。确认后只回收列出的两个目录", async (t) => {
  const { dir, root, backup, active, offer } = await fixture();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const recycled: string[] = [];
  const recycle = async (path: string) => {
    recycled.push(path);
    await rename(path, join(dir, "trash-" + recycled.length));
  };
  assert.equal(
    await offer(async (preview) => {
      assert.deepEqual(preview, { copy: root, backup, bytes: 14 });
      return false;
    }, recycle),
    false,
  );
  assert.deepEqual(recycled, []);
  assert.equal(await exists(active), false);
  assert.equal(await offer(async () => true, recycle), true);
  assert.deepEqual(recycled, [root, backup]);
  assert.equal(await exists(root), false);
  const { generation } = JSON.parse(await readFile(active, "utf8"));
  assert.match(generation, /^[a-f0-9]{64}$/);
});
test("用户确认期间副本被改动时保留两个目录，回收失败准确报告剩余备份", async (t) => {
  const { dir, root, backup, active, offer } = await fixture();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(root, "resources/app.asar");
  await assert.rejects(
    offer(
      async () => {
        await writeFile(file, "changed");
        return true;
      },
      async () => assert.fail("不能回收"),
    ),
    /发生变化/,
  );
  assert.equal(await exists(active), false);
  await writeFile(file, "fixture");
  await assert.rejects(
    offer(
      async () => true,
      async (path) => {
        if (path === backup) throw Error("占用中");
        await rename(path, join(dir, "trash-copy"));
      },
    ),
    /副本已移入回收站，备份仍在/,
  );
  assert.equal(await exists(backup), true);
});
