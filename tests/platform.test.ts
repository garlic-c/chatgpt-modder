import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NtExecutable, NtExecutableResource } from "resedit";
import { peHeaderHash, rewritePeHeaderHash } from "../src/engine/windows-pe";
import {
  localEntitlements,
  verifyAsarIntegrity,
} from "../src/engine/platform";
import { rewriteMacDigest } from "../src/engine/mac-digest";
import { Asar } from "../src/engine/asar";
import { makeAsar } from "./helpers";
import { createHash } from "node:crypto";
test("Mac 框架摘要同步更新，完整性校验保持启用", () => {
  const sentinel = Buffer.from("AGbevlPCksUGKNL8TSn7wGmJEuJsXb2A");
  const binary = Buffer.concat([
    Buffer.from("prefix"),
    sentinel,
    Buffer.alloc(34),
    Buffer.from("suffix"),
  ]);
  const value = {
    "Resources/app.asar": { algorithm: "SHA256", hash: "a".repeat(64) },
  };
  const next = rewriteMacDigest(binary, value),
    start = 6 + sentinel.length;
  assert.equal(next[start], 1);
  assert.equal(next[start + 1], 1);
  assert.deepEqual(
    next.subarray(start + 2, start + 34),
    createHash("sha256")
      .update("Resources/app.asarSHA256" + "a".repeat(64))
      .digest(),
  );
  assert.equal(next.subarray(-6).toString(), "suffix");
  assert.throws(() => rewriteMacDigest(Buffer.alloc(40), value));
  const unknown = Buffer.from(binary);
  unknown[start + 1] = 2;
  assert.throws(() => rewriteMacDigest(unknown, value));
});
test("Windows PE 完整性资源重写并保留其他资源", () => {
  const exe = NtExecutable.createEmpty(false, false),
    resources = NtExecutableResource.from(exe);
  resources.replaceResourceEntryFromString(
    "Integrity",
    "ElectronAsar",
    1033,
    JSON.stringify([
      { file: "resources\\app.asar", alg: "sha256", value: "a".repeat(64) },
    ]),
  );
  resources.replaceResourceEntryFromString("CUSTOM", "KEEP", 1033, "保留");
  resources.outputResource(exe);
  const original = Buffer.from(exe.generate());
  assert.equal(peHeaderHash(original), "a".repeat(64));
  const modified = rewritePeHeaderHash(original, "b".repeat(64));
  assert.equal(peHeaderHash(modified), "b".repeat(64));
  const next = NtExecutableResource.from(NtExecutable.from(modified));
  assert.equal(next.getResourceEntriesAsString("CUSTOM", "KEEP")[0][1], "保留");
  assert.throws(() => rewritePeHeaderHash(original, "invalid"));
  assert.throws(() => peHeaderHash(Buffer.from("bad")));
});
test("Windows 缺失或未知的完整性资源不能写入", () => {
  const exe = NtExecutable.createEmpty(false, false);
  assert.throws(() =>
    rewritePeHeaderHash(Buffer.from(exe.generate()), "a".repeat(64)),
  );
});

test("Windows 实机格式：大写 SHA256、双反斜杠路径可读写且保留原格式", () => {
  const fixture = (values: unknown) => {
    const exe = NtExecutable.createEmpty(false, false);
    const resources = NtExecutableResource.from(exe);
    resources.replaceResourceEntryFromString(
      "INTEGRITY",
      "ELECTRONASAR",
      1033,
      JSON.stringify(values),
    );
    resources.outputResource(exe);
    return Buffer.from(exe.generate());
  };
  const item = {
    file: "resources\\\\app.asar",
    alg: "SHA256",
    value: "a".repeat(64),
  };
  const binary = fixture([item]);
  assert.equal(peHeaderHash(binary), item.value);
  const changed = rewritePeHeaderHash(binary, "b".repeat(64));
  assert.equal(peHeaderHash(changed), "b".repeat(64));
  const resources = NtExecutableResource.from(NtExecutable.from(changed));
  const values = JSON.parse(
    resources.getResourceEntriesAsString("INTEGRITY", "ELECTRONASAR")[0][1],
  );
  assert.deepEqual(values, [{ ...item, value: "b".repeat(64) }]);
  for (const invalid of [
    [{ ...item, alg: "SHA1" }],
    [{ ...item, file: "../resources/app.asar" }],
    [item, item],
    [null],
    {},
  ])
    assert.throws(() => rewritePeHeaderHash(fixture(invalid), "b".repeat(64)));
});
test("Linux ASAR 完整性条目与文件内容自洽校验", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "cgm-linux-asar-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const path = join(temp, "app.asar");
  await makeAsar(path, { "a.txt": "hello", "dir/b.txt": "world" });
  await verifyAsarIntegrity(await Asar.load(path));
  const bytes = await readFile(path);
  bytes[bytes.length - 1] ^= 1;
  await writeFile(path, bytes);
  await assert.rejects(
    async () => verifyAsarIntegrity(await Asar.load(path)),
    /完整性校验不一致/,
  );
});
test("Linux ASAR 校验覆盖解包到 app.asar.unpacked 的条目", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "cgm-linux-asar-unpacked-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const path = join(temp, "app.asar");
  const packed = Buffer.from("packed"),
    unpacked = Buffer.from("unpacked-bytes");
  const integrity = (b: Buffer) => ({
    algorithm: "SHA256",
    hash: createHash("sha256").update(b).digest("hex"),
    blockSize: 4194304,
    blocks: [createHash("sha256").update(b).digest("hex")],
  });
  const header = {
    files: {
      "a.txt": { size: packed.length, offset: "0", integrity: integrity(packed) },
      "native.node": {
        size: unpacked.length,
        unpacked: true,
        integrity: integrity(unpacked),
      },
    },
  };
  const json = Buffer.from(JSON.stringify(header)),
    padded = (4 + json.length + 3) & ~3,
    prefix = Buffer.alloc(12 + padded);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(4 + padded, 4);
  prefix.writeUInt32LE(padded, 8);
  prefix.writeUInt32LE(json.length, 12);
  json.copy(prefix, 16);
  await writeFile(path, Buffer.concat([prefix, packed]));
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path + ".unpacked", { recursive: true });
  await writeFile(join(path + ".unpacked", "native.node"), unpacked);
  await verifyAsarIntegrity(await Asar.load(path));
  await writeFile(join(path + ".unpacked", "native.node"), "tampered");
  await assert.rejects(
    async () => verifyAsarIntegrity(await Asar.load(path)),
    /完整性校验不一致/,
  );
});
test("Mac 本地签名剔除团队专属授权，保留必要 JIT 授权", () => {
  const result = localEntitlements({
    "com.apple.application-identifier": "team.app",
    "com.apple.developer.team-identifier": "team",
    "com.apple.developer.aps-environment": "production",
    "keychain-access-groups": ["team.*"],
    "com.apple.security.application-groups": ["team.group"],
    "com.apple.security.cs.allow-jit": true,
  });
  assert.deepEqual(result, {
    "com.apple.security.cs.allow-jit": true,
    "com.apple.security.cs.disable-library-validation": true,
  });
});
