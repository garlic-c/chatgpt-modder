import type { Inspection } from "../engine/engine";
type ClientState = Inspection & { icon?: string };
interface API {
  detect(): Promise<{
    path: string;
    inspection: ClientState | null;
    error?: string;
  } | null>;
  version(): Promise<string>;
  choose(): Promise<string | null>;
  modules(): Promise<
    { id: string; name: string; description: string; version: string }[]
  >;
  inspect(path: string): Promise<ClientState>;
  diagnose(path: string): Promise<boolean>;
  apply(path: string, ids: string[]): Promise<ClientState>;
  restore(path: string): Promise<ClientState>;
  recover(path: string): Promise<ClientState>;
  onLog(fn: (s: string) => void): () => void;
}
declare global {
  interface Window {
    modder: API;
  }
}
const el = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
let path = "",
  state: ClientState | null = null,
  busy = false,
  detecting = true;
const checkbox = el<HTMLInputElement>("quota"),
  toggles = new Map<string, HTMLInputElement>([["quota", checkbox]]);
const selected = () =>
  [...toggles].filter(([, input]) => input.checked).map(([id]) => id);
function status(message = "", error = false) {
  const target = el("status");
  target.textContent = message;
  target.hidden = !message;
  target.classList.toggle("error", error);
}
function clientButton(installed: boolean, icon?: string) {
  el("client-label").textContent = installed ? "已定位" : "选择客户端";
  el("choose").classList.toggle("installed", installed);
  el("choose").title = installed
    ? `ChatGPT${state ? " · " + state.version : ""}\n${path}\n点击更换客户端`
    : "选择 ChatGPT 客户端";
  const image = el<HTMLImageElement>("client-icon");
  if (icon) image.src = icon;
  image.hidden = !installed || !image.getAttribute("src");
}
function sync() {
  el<HTMLButtonElement>("choose").disabled = busy || detecting;
  for (const input of toggles.values())
    input.disabled = busy || detecting || !state?.compatible;
  el<HTMLButtonElement>("apply").disabled =
    busy || detecting || !state?.compatible || !!state?.pending;
  el<HTMLButtonElement>("restore").disabled =
    busy ||
    detecting ||
    !state?.compatible ||
    !state.modules.length ||
    state.pending;
  el<HTMLButtonElement>("recover").disabled = busy || detecting || !path;
  el<HTMLButtonElement>("diagnose").disabled = busy || detecting || !path;
  document.querySelector<HTMLElement>(".mock-quota")!.style.opacity =
    checkbox.checked ? "1" : "0";
}
function show(s: ClientState) {
  state = s;
  path = s.root;
  clientButton(true, s.icon);
  status(
    s.compatible && !["store-copy", "user-copy"].includes(s.status)
      ? ""
      : s.message,
    !s.compatible,
  );
  for (const [id, input] of toggles) input.checked = s.modules.includes(id);
  sync();
}
async function action(fn: () => Promise<ClientState>) {
  busy = true;
  status();
  sync();
  try {
    show(await fn());
  } catch (e) {
    status(
      (e as Error).message.replace(
        /^Error invoking remote method '[^']+': Error: /,
        "",
      ),
      true,
    );
  } finally {
    busy = false;
    sync();
  }
}
el("choose").onclick = async () => {
  try {
    const chosen = await window.modder.choose();
    if (!chosen) return;
    path = chosen;
    state = null;
    await action(() => window.modder.inspect(path));
  } catch (e) {
    status((e as Error).message, true);
  }
};
el("apply").onclick = () => {
  recentLogs.length = 0;
  el("log").replaceChildren();
  void action(() => window.modder.apply(path, selected()));
};
el("restore").onclick = () => {
  void action(() => window.modder.restore(path));
};
el("recover").onclick = () => {
  void action(() => window.modder.recover(path));
};
el("diagnose").onclick = async () => {
  try {
    if (await window.modder.diagnose(path)) status("兼容诊断已导出。");
  } catch (e) {
    status((e as Error).message, true);
  }
};
checkbox.onchange = sync;
const recentLogs: string[] = [];
window.modder.onLog((message) => {
  recentLogs.push(
    ...message
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
  recentLogs.splice(0, Math.max(0, recentLogs.length - 3));
  const rows = recentLogs.map((line) => {
    const row = document.createElement("div");
    row.textContent = line;
    row.title = line;
    return row;
  });
  el("log").replaceChildren(...rows);
});
sync();
void window.modder
  .version()
  .then((version) => {
    el("version").textContent = version;
  })
  .catch(() => {});
void window.modder
  .modules()
  .then((modules) => {
    for (const module of modules) {
      if (toggles.has(module.id)) continue;
      const card = document.createElement("section");
      card.className = "feature module-extra";
      const row = document.createElement("div");
      row.className = "feature-heading";
      const heading = document.createElement("h2");
      heading.textContent = module.name;
      const label = document.createElement("label");
      label.className = "switch-row";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = state?.modules.includes(module.id) ?? false;
      input.setAttribute("aria-label", module.name);
      input.setAttribute("role", "switch");
      const control = document.createElement("span");
      control.className = "switch";
      control.setAttribute("aria-hidden", "true");
      label.append(input, control);
      row.append(heading, label);
      card.append(row);
      el("modules").append(card);
      toggles.set(module.id, input);
      input.onchange = sync;
    }
    sync();
  })
  .catch((e) => status(String(e), true));
void window.modder
  .detect()
  .then((result) => {
    if (result?.inspection) show(result.inspection);
    else if (result) {
      path = result.path;
      clientButton(true);
      status(result.error || "无法检查该客户端，请重新选择。", true);
    } else {
      clientButton(false);
    }
  })
  .catch((e) => {
    clientButton(false);
    status("自动检测失败，请选择客户端。", true);
  })
  .finally(() => {
    detecting = false;
    sync();
  });
