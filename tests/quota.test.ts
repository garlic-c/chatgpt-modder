import { test } from "node:test";
import assert from "node:assert/strict";
import { quotaView, remaining, type Usage } from "../src/modules/quota-model";
import { quotaModule, quotaTarget, resolveModules } from "../src/modules/quota";
const now = 1800000000000;
const usage: Usage = {
  account_id: "a",
  user_id: "u",
  rate_limit: {
    primary_window: {
      used_percent: 18,
      limit_window_seconds: 18000,
      reset_at: now / 1000 + 9300,
    },
    secondary_window: {
      used_percent: 39,
      limit_window_seconds: 604800,
      reset_at: now / 1000 + 86400,
    },
  },
};
test("剩余额度与重置倒计时", () =>
  assert.deepEqual(quotaView(usage, "a", "u", now), {
    five: 82,
    week: 61,
    countdown: "2h35m",
    needsRefresh: false,
  }));
test("按窗口时长识别，不依赖 primary/secondary 次序", () => {
  const reversed = {
    ...usage,
    rate_limit: {
      primary_window: usage.rate_limit!.secondary_window,
      secondary_window: usage.rate_limit!.primary_window,
    },
  };
  assert.equal(quotaView(reversed, "a", "u", now).five, 82);
});
test("空数据不会显示满额", () =>
  assert.equal(quotaView(null, "a", "u", now).five, null));
test("切换账号不残留额度", () =>
  assert.equal(quotaView(usage, "b", "u", now).week, null));
test("用户不匹配不残留额度", () =>
  assert.equal(quotaView(usage, "a", "v", now).five, null));
test("离线错误状态使用占位", () =>
  assert.equal(quotaView(usage, "a", "u", now, true).countdown, "--h--m"));
test("耗尽额度显示零", () => assert.equal(remaining({ used_percent: 100 }), 0));
test("百分比越界及无效数据", () => {
  assert.equal(remaining({ used_percent: 120 }), 0);
  assert.equal(remaining({ used_percent: -5 }), 100);
  assert.equal(remaining({ used_percent: NaN }), null);
  assert.equal(remaining({}), null);
});
test("达到重置时间请求刷新，不假定满额", () => {
  const view = quotaView(usage, "a", "u", now + 9300001);
  assert.equal(view.five, null);
  assert.equal(view.countdown, "0h00m");
  assert.equal(view.needsRefresh, true);
});
test("休眠唤醒用当前时间重新计算", () =>
  assert.equal(quotaView(usage, "a", "u", now + 3600000).countdown, "1h35m"));
test("未提供的窗口不被误识别", () =>
  assert.equal(
    quotaView(
      {
        ...usage,
        rate_limit: {
          primary_window: { used_percent: 3, limit_window_seconds: 900 },
        },
      },
      "a",
      "u",
      now,
    ).five,
    null,
  ));
test("锚点缺失、重复和已安装不能直接打补丁", () => {
  assert.throws(() => quotaModule.prepare(new Map()));
  const files = new Map([[quotaTarget, "function Ozn(e){return e}"]]);
  const edits = quotaModule.prepare(files);
  assert.equal(
    quotaModule.verify(new Map([[quotaTarget, edits[0].after]])),
    true,
  );
  assert.throws(() =>
    quotaModule.prepare(new Map([[quotaTarget, edits[0].after]])),
  );
});
test("模块未知、重复、依赖、冲突及循环检查", () => {
  assert.throws(() => resolveModules(["unknown"]));
  assert.throws(() => resolveModules(["quota", "quota"]));
  assert.throws(() =>
    resolveModules(["quota"], [{ ...quotaModule, dependencies: ["missing"] }]),
  );
  assert.throws(() =>
    resolveModules(
      ["quota", "other"],
      [
        { ...quotaModule, conflicts: ["other"] },
        { ...quotaModule, id: "other", targets: [] },
      ],
    ),
  );
  assert.throws(() =>
    resolveModules(
      ["quota", "other"],
      [
        { ...quotaModule, dependencies: ["other"] },
        { ...quotaModule, id: "other", dependencies: ["quota"], targets: [] },
      ],
    ),
  );
  assert.throws(() =>
    resolveModules(
      ["quota", "other"],
      [quotaModule, { ...quotaModule, id: "other" }],
    ),
  );
});
