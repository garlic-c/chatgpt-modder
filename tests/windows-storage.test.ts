import { test } from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { backupBase, windowsLocalData } from "../src/engine/windows-storage";
import { WindowsCopy } from "../src/engine/windows-copy";
import { sha256 } from "../src/engine/asar";

test("Windows 新的备份使用 Local，已有事务继续使用原锁和目录", async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), "modder-storage-"));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const local = windowsLocalData(tmp, { LOCALAPPDATA: join(tmp, "local") });
  const legacy = join(tmp, "roaming");
  const client = join(tmp, "client");
  const key = sha256(resolve(client));
  assert.equal(backupBase(local, client, legacy), join(local, key));
  await mkdir(join(legacy, key), { recursive: true });
  assert.equal(backupBase(local, client, legacy), join(legacy, key));
  await mkdir(join(local, key), { recursive: true });
  assert.throws(() => backupBase(local, client, legacy), /两套/);
});
test("只识别受管客户端，不误选相似前缀或任意子目录", () => {
  const clients = resolve("clients");
  const copies = new WindowsCopy(clients);
  const suffix = join("f".repeat(64), "client");
  assert.ok(copies.owns(join(clients, suffix)));
  assert.ok(!copies.owns(join(clients + "-other", suffix)));
  assert.ok(!copies.owns(join(clients, "client")));
});
