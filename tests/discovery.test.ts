import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clientCandidates,
  discoverClient,
  storeLocations,
  type DiscoveryReport,
} from "../src/engine/discovery";

test("清单候选检查失败仍显示已定位，保留诊断；普通残留目录不误报", async () => {
  const root = await mkdtemp(join(tmpdir(), "cgm-discovery-report-"));
  try {
    const report: DiscoveryReport = {
      candidates: [{ path: root, source: "store" }],
    };
    const inspect = async () => {
      throw Error("Windows 完整性资源格式不匹配");
      return { compatible: false };
    };
    const result = await discoverClient([root], inspect, report);
    assert.equal(result?.path, root);
    assert.equal(result?.inspection, null);
    assert.match(result!.error!, /完整性资源格式不匹配/);
    assert.equal(report.candidates[0].stage, "inspect");
    assert.match(report.candidates[0].error!, /完整性资源/);
    report.candidates[0].source = "common";
    assert.equal(await discoverClient([root], inspect, report), null);
    const valid = join(root, "valid");
    await mkdir(valid);
    report.candidates[0].source = "store";
    assert.equal(
      (
        await discoverClient(
          [root, valid],
          async (p) => (p === root ? inspect() : { compatible: true }),
          report,
        )
      )?.path,
      valid,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("结构化商店发现结果保留路径兼容性", () => {
  const path = "C:\\Program Files\\WindowsApps\\OpenAI.Codex\\app";
  assert.deepEqual(
    storeLocations(
      JSON.stringify({ paths: [path], manifestErrors: ["manifest failed"] }),
    ),
    [path],
  );
});
test("macOS 自动搜索记住的路径、系统和用户应用目录", async () => {
  const paths = await clientCandidates(
    "darwin",
    "/custom/ChatGPT.app",
    {},
    "/test-user",
  );
  assert.deepEqual(paths, [
    "/custom/ChatGPT.app",
    "/Applications/ChatGPT.app",
    "/test-user/Applications/ChatGPT.app",
  ]);
});
test("自动检测跳过残留目录，优先可用客户端，保留不兼容客户端结果", async () => {
  const root = await mkdtemp(join(tmpdir(), "cgm-discovery-"));
  try {
    const invalid = join(root, "invalid"),
      unknown = join(root, "unknown"),
      valid = join(root, "valid");
    for (const p of [invalid, unknown, valid]) await mkdir(p);
    const inspect = async (p: string) => {
      if (p === invalid) throw Error("not a client");
      return { compatible: p === valid };
    };
    assert.equal(await discoverClient([invalid], inspect), null);
    assert.equal(
      (
        await discoverClient(
          [join(root, "missing"), invalid, unknown, valid],
          inspect,
        )
      )?.path,
      valid,
    );
    assert.equal(
      (await discoverClient([unknown], inspect))?.inspection?.compatible,
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
import { icnsPng } from "../src/engine/icons";
test("客户端图标读取 PNG 图块，拒绝越界和空图块", () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]),
    b = Buffer.alloc(16 + png.length);
  b.write("icns");
  b.writeUInt32BE(b.length, 4);
  b.write("ic07", 8);
  b.writeUInt32BE(png.length + 8, 12);
  png.copy(b, 16);
  assert.deepEqual(icnsPng(b), png);
  b.writeUInt32BE(0, 12);
  assert.equal(icnsPng(b), null);
  b.writeUInt32BE(1000, 12);
  assert.equal(icnsPng(b), null);
  assert.equal(icnsPng(Buffer.from("bad")), null);
});
