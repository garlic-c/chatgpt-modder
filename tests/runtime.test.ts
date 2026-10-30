import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { quotaRuntime, legacyQuotaBinding } from "../src/modules/quota";
import { adapters } from "../src/modules/adapters";
const require = createRequire(__filename);
const { JSDOM } = require("jsdom"),
  React = require("react"),
  { createRoot } = require("react-dom/client"),
  jsx = require("react/jsx-runtime");
for (const binding of [
  legacyQuotaBinding,
  adapters.find((a) => a.id === "win-26.1027.30824-x64")!.quota!,
]) {
  const evaluateQuota = (context: Record<string, unknown>) => {
    const aliases: Record<string, string> = {
      Mzn: binding.react,
      eK: binding.jsx,
      Q: binding.read,
      ab: binding.query,
      $: binding.scope,
      Fi: binding.scopeHook,
      Xw: binding.account,
    };
    const mapped = Object.fromEntries(
      Object.entries(context).map(([key, value]) => [
        aliases[key] ?? key,
        value,
      ]),
    );
    return runInNewContext(
      quotaRuntime(binding) + ";" + binding.profile,
      mapped,
    );
  };
  test(`注入组件 ${binding.profile}：真实 React 渲染、账户切换、重复渲染和卸载清理`, async () => {
    const dom = new JSDOM('<div id="root"></div>');
    const saved = { window: globalThis.window, document: globalThis.document };
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      IS_REACT_ACT_ENVIRONMENT: true,
    });
    let timers = 0,
      identity = { authMethod: "chatgpt", accountId: "a", userId: "u" };
    const now = Date.now(),
      data = {
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
    let invalidations = 0,
      failQuery = false;
    const Component = evaluateQuota({
      Mzn: React,
      eK: jsx,
      Q: () => {
        if (failQuery) throw Error("模拟模块故障");
        return { data, isError: false };
      },
      ab: {},
      $: {},
      Fi: () => ({
        query: {
          invalidate: () => {
            invalidations++;
          },
        },
      }),
      Xw: () => identity,
      CGMOriginalProfile: () => jsx.jsx("button", { children: "头像" }),
      window: dom.window,
      document: dom.window.document,
      Date,
      setInterval: () => ++timers,
      clearInterval: () => timers--,
    });
    const root = createRoot(dom.window.document.getElementById("root"));
    try {
      await React.act(async () =>
        root.render(React.createElement(Component, { compact: false })),
      );
      assert.match(dom.window.document.body.textContent, /82%/);
      assert.match(dom.window.document.body.textContent, /2h35m/);
      assert.equal(
        dom.window.document
          .querySelector("[role=progressbar]")
          .getAttribute("aria-valuenow"),
        "61",
      );
      await React.act(async () =>
        root.render(React.createElement(Component, { compact: true })),
      );
      assert.equal(
        dom.window.document.querySelectorAll("[data-cgm-quota]").length,
        1,
      );
      assert.equal(timers, 1);
      for (const [used, red] of [
        [89, false],
        [90, true],
        [100, true],
      ] as const) {
        data.rate_limit.primary_window.used_percent = used;
        await React.act(async () =>
          root.render(React.createElement(Component, { compact: true })),
        );
        const percentage = dom.window.document.querySelector(
          "[data-cgm-quota] > span",
        ) as HTMLElement;
        assert.equal(percentage.style.color.includes("--text-danger"), red);
      }
      identity = { ...identity, accountId: "b" };
      await React.act(async () =>
        root.render(React.createElement(Component, { compact: false })),
      );
      assert.match(dom.window.document.body.textContent, /--%/);
      assert.equal(
        dom.window.document
          .querySelector("[role=progressbar]")
          .hasAttribute("aria-valuenow"),
        false,
      );
      assert.equal(invalidations, 0);
      failQuery = true;
      const oldError = console.error;
      console.error = () => {};
      try {
        await React.act(async () =>
          root.render(React.createElement(Component, { compact: true })),
        );
      } finally {
        console.error = oldError;
      }
      assert.equal(
        dom.window.document.querySelectorAll("[data-cgm-quota]").length,
        0,
      );
      assert.match(dom.window.document.body.textContent, /头像/);
    } finally {
      await React.act(async () => root.unmount());
      assert.equal(timers, 0);
      Object.assign(globalThis, saved);
      dom.window.close();
    }
  });

  test(`额度组件 ${binding.profile}：异步等待不能触发整页初始化，恢复后自动显示额度`, async () => {
    const dom = new JSDOM('<div id="root"></div>');
    const saved = { window: globalThis.window, document: globalThis.document };
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      IS_REACT_ACT_ENVIRONMENT: true,
    });
    let resolvePending: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      resolvePending = resolve;
    });
    let ready = false;
    const now = Date.now();
    const Component = evaluateQuota({
      Mzn: React,
      eK: jsx,
      Q: () => {
        if (!ready) throw pending;
        return {
          data: {
            account_id: "a",
            user_id: "u",
            rate_limit: {
              primary_window: {
                used_percent: 18,
                limit_window_seconds: 18000,
                reset_at: now / 1000 + 9300,
              },
            },
          },
          isError: false,
        };
      },
      ab: {},
      $: {},
      Fi: () => ({ query: { invalidate: () => {} } }),
      Xw: () => ({ authMethod: "chatgpt", accountId: "a", userId: "u" }),
      CGMOriginalProfile: () => jsx.jsx("button", { children: "原有头像" }),
      window: dom.window,
      document: dom.window.document,
      Date,
      setInterval: () => 1,
      clearInterval: () => {},
    });
    const root = createRoot(dom.window.document.getElementById("root"));
    try {
      await React.act(async () =>
        root.render(
          React.createElement(
            React.Suspense,
            {
              fallback: React.createElement(
                "div",
                { "data-host-initializing": "1" },
                "应用正在初始化",
              ),
            },
            React.createElement(Component, { compact: false }),
          ),
        ),
      );
      assert.equal(
        Boolean(dom.window.document.querySelector("[data-host-initializing]")),
        false,
        "额度等待冒泡到了宿主的整页加载边界",
      );
      assert.match(dom.window.document.body.textContent, /原有头像/);
      assert.match(dom.window.document.body.textContent, /--%/);
      await React.act(async () => {
        ready = true;
        resolvePending();
        await pending;
      });
      assert.match(dom.window.document.body.textContent, /82%/);
      assert.match(dom.window.document.body.textContent, /原有头像/);
      assert.equal(
        dom.window.document.querySelectorAll("[data-cgm-quota]").length,
        1,
      );
    } finally {
      await React.act(async () => root.unmount());
      Object.assign(globalThis, saved);
      dom.window.close();
    }
  });
}
