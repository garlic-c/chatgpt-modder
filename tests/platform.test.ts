import { test } from "node:test";
import assert from "node:assert/strict";
import { NtExecutable, NtExecutableResource } from "resedit";
import { peHeaderHash, rewritePeHeaderHash } from "../src/engine/windows-pe";
import { localEntitlements } from "../src/engine/platform";
import { rewriteMacDigest } from "../src/engine/mac-digest";
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
