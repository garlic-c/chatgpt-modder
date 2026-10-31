import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  chmod,
  lstat,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LinuxCopy } from "../src/engine/linux-copy";
import { treeHash } from "../src/engine/files";

test(
  "Linux 副本保持官方文件不变，保留权限位，支持重复准备与版本隔离",
  // LinuxCopy 只在 Linux 上运行：权限位断言（0o555/0o444/可执行位）
  // 在 Windows 上没有 POSIX 语义，沿用仓库里 macOS/Windows 拷贝测试的
  // 平台跳过写法，而不是放宽断言。
  { skip: process.platform !== "linux" },
  async () => {
  const temp = await mkdtemp(join(tmpdir(), "cgm-linux-copy-"));
  try {
    const source = join(temp, "official"),
      storage = join(temp, "copies");
    await mkdir(join(source, "resources"), { recursive: true });
    await writeFile(join(source, "resources/app.asar"), "original-asar");
    await writeFile(join(source, "ChatGPT"), "original-exe");
    await chmod(join(source, "ChatGPT"), 0o555);
    await writeFile(join(source, "resources/data.bin"), "read-only");
    await chmod(join(source, "resources/data.bin"), 0o444);
    const before = await treeHash(source),
      copies = new LinuxCopy(storage);
    const root = await copies.prepare(
      source,
      async (stage) => {
        // The copy gains owner write access but keeps executable bits so
        // the patched client can still launch.
        const exe = await lstat(join(stage, "ChatGPT"));
        assert.equal(exe.mode & 0o500, 0o500);
        const data = await lstat(join(stage, "resources/data.bin"));
        assert.equal(data.mode & 0o200, 0o200);
        assert.equal(data.mode & 0o111, 0);
      },
      () => {},
    );
    assert.equal(await treeHash(source), before);
    await writeFile(join(root, "resources/app.asar"), "patched");
    assert.equal(
      await copies.prepare(
        source,
        async () => {
          throw Error("must reuse");
        },
        () => {},
      ),
      root,
    );
    assert.equal(
      await readFile(join(root, "resources/app.asar"), "utf8"),
      "patched",
    );
    await writeFile(join(source, "resources/app.asar"), "new-version");
    assert.equal(await copies.existing(source), null);
    const next = await copies.prepare(
      source,
      async () => {},
      () => {},
    );
    assert.notEqual(next, root);
    assert.equal(
      await readFile(join(root, "resources/app.asar"), "utf8"),
      "patched",
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test(
  "Linux 副本不复制符号链接",
  { skip: process.platform !== "linux" },
  async () => {
  const temp = await mkdtemp(join(tmpdir(), "cgm-linux-links-"));
  try {
    const source = join(temp, "official");
    await mkdir(join(source, "resources"), { recursive: true });
    await writeFile(join(source, "resources/app.asar"), "asar");
    await symlink(temp, join(source, "escape"));
    await assert.rejects(
      new LinuxCopy(join(temp, "copies")).prepare(
        source,
        async () => {},
        () => {},
      ),
      /符号链接/,
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
