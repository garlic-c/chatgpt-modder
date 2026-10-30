import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WindowsCopy } from "../src/engine/windows-copy";
import { treeHash, exists } from "../src/engine/files";
import { storeLocations, storeDiscoveryScript } from "../src/engine/discovery";

test("商店定位解析支持单路径、数组、BOM、中文；忽略无效路径", () => {
  const path = "C:\\Program Files\\WindowsApps\\OpenAI.ChatGPT\\app";
  assert.deepEqual(
    storeLocations(
      "\uFEFF" + JSON.stringify([path, path, null, "relative", 42]),
    ),
    [path],
  );
  assert.deepEqual(storeLocations(JSON.stringify(path)), [path]);
  assert.deepEqual(storeLocations(""), []);
  assert.match(storeDiscoveryScript, /Get-AppxPackageManifest/);
});

test("商店副本保持官方文件不变，支持重复准备、版本隔离和失败清理", async () => {
  const temp = await mkdtemp(join(tmpdir(), "cgm-win-copy-"));
  try {
    const source = join(temp, "official"),
      storage = join(temp, "copies");
    await mkdir(join(source, "resources"), { recursive: true });
    await writeFile(join(source, "resources/app.asar"), "original-asar");
    await writeFile(join(source, "ChatGPT.exe"), "original-exe");
    await writeFile(join(source, "AppxManifest.xml"), "<Package/>");
    const before = await treeHash(source),
      copies = new WindowsCopy(storage);
    const root = await copies.prepare(
      source,
      async (stage) => {
        assert.equal(await exists(join(stage, "AppxManifest.xml")), false);
        assert.equal(
          await readFile(join(stage, "ChatGPT.exe"), "utf8"),
          "original-exe",
        );
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
    await assert.rejects(
      copies.prepare(
        source,
        async () => {
          throw Error("unsupported");
        },
        () => {},
      ),
      /unsupported/,
    );
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
  "不复制逃逸到外部目录的符号链接",
  { skip: process.platform === "win32" },
  async () => {
    const temp = await mkdtemp(join(tmpdir(), "cgm-win-links-"));
    try {
      const source = join(temp, "official");
      await mkdir(join(source, "resources"), { recursive: true });
      await writeFile(join(source, "resources/app.asar"), "asar");
      await symlink(temp, join(source, "escape"));
      await assert.rejects(
        new WindowsCopy(join(temp, "copies")).prepare(
          source,
          async () => {},
          () => {},
        ),
        /符号链接/,
      );
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  },
);
